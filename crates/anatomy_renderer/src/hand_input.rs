use glam::{Vec2, Vec3};
use serde::Serialize;

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum HandCameraCommand {
    Rotate { x: f32, y: f32 },
    Pan { x: f32, y: f32 },
    Zoom { factor: f32 },
}

#[derive(Serialize, Debug)]
pub struct HandCursor {
    pub side: &'static str,
    pub x: f32,
    pub y: f32,
    pub pinching: bool,
    pub state: &'static str,
    pub landmarks: [[f32; 3]; 21],
}

#[derive(Serialize, Debug)]
pub struct HandInputResult {
    pub mode: &'static str,
    pub hands: Vec<HandCursor>,
    pub zoom: &'static str,
    pub commands: Vec<HandCameraCommand>,
}

impl HandInputResult {
    fn idle() -> Self {
        Self {
            mode: "idle",
            hands: Vec::new(),
            zoom: "none",
            commands: Vec::new(),
        }
    }
}

struct Sample {
    mask: u8,
    center: Vec2,
    span: f32,
}

#[derive(Default)]
pub struct HandInput {
    timestamp: Option<f64>,
    aspect: f32,
    pinching: [bool; 2],
    blocked: [bool; 2],
    captured: u8,
    positions: [Option<Vec2>; 2],
    landmarks: [Option<[Vec3; 21]>; 2],
    previous: Option<Sample>,
}

impl HandInput {
    pub fn cancel_controls(&mut self) {
        self.captured = 0;
        self.previous = None;
        self.blocked = [true; 2];
    }

    pub fn reset(&mut self) {
        *self = Self::default();
        self.blocked = [true; 2];
    }

    pub fn update(&mut self, hands: &[f32], timestamp: f64, aspect: f32) -> HandInputResult {
        self.update_in_region(hands, timestamp, aspect, &[0.0, 0.0, 1.0, 1.0])
    }

    pub fn update_in_region(
        &mut self,
        hands: &[f32],
        timestamp: f64,
        aspect: f32,
        region: &[f32],
    ) -> HandInputResult {
        if !timestamp.is_finite()
            || timestamp < 0.0
            || !aspect.is_finite()
            || !(0.1..=10.0).contains(&aspect)
            || hands.len() > 130
            || !hands.len().is_multiple_of(65)
            || hands.iter().any(|v| !v.is_finite())
            || region.len() < 4
            || region.len() > 32
            || !region.len().is_multiple_of(4)
            || region
                .iter()
                .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
            || region.chunks_exact(4).any(|r| r[0] > r[2] || r[1] > r[3])
            || self.timestamp.is_some_and(|before| timestamp <= before)
        {
            self.reset();
            return HandInputResult::idle();
        }
        let elapsed = self.timestamp.map_or(33.0, |before| timestamp - before);
        if self.timestamp.is_some() && (elapsed > 200.0 || (self.aspect - aspect).abs() > 0.01) {
            self.reset();
        }
        self.timestamp = Some(timestamp);
        self.aspect = aspect;
        let scale = Vec2::new(aspect, 1.0);
        let contains = |r: &[f32], point: Vec2| {
            r[0] < r[2]
                && r[1] < r[3]
                && point.x >= r[0]
                && point.x <= r[2]
                && point.y >= r[1]
                && point.y <= r[3]
        };
        let eligible = |point| {
            contains(&region[..4], point)
                && !region[4..].chunks_exact(4).any(|r| contains(r, point))
        };
        let mut detected = [None; 2];
        let mut seen = [false; 2];
        for hand in hands.chunks_exact(65) {
            if ![0.0, 1.0].contains(&hand[0])
                || !(0.0..=1.0).contains(&hand[1])
                || hand[2..].chunks_exact(3).any(|p| {
                    !(-0.5..=1.5).contains(&p[0])
                        || !(-0.5..=1.5).contains(&p[1])
                        || p[2].abs() > 10.0
                })
            {
                self.reset();
                return HandInputResult::idle();
            }
            let side = hand[0] as usize;
            if seen[side] {
                self.reset();
                return HandInputResult::idle();
            }
            seen[side] = true;
            if hand[1] < 0.65 {
                continue;
            }
            let point = |index: usize| Vec2::new(1.0 - hand[2 + index * 3], hand[3 + index * 3]);
            let palm = ((point(0) - point(9)) * scale).length();
            if palm < 0.02 {
                continue;
            }
            let ratio = ((point(4) - point(8)) * scale).length() / palm;
            let landmarks = std::array::from_fn(|index| {
                Vec3::new(
                    1.0 - hand[2 + index * 3],
                    hand[3 + index * 3],
                    hand[4 + index * 3],
                )
            });
            detected[side] = Some(((point(4) + point(8)) * 0.5, ratio, landmarks));
        }
        let alpha = (1.0 - (-elapsed as f32 / 45.0).exp()).clamp(0.0, 1.0);
        let mut mask = 0;
        let mut starts = 0;
        let mut disrupted = 0;
        let mut inside = [false; 2];
        for (side, detection) in detected.iter().enumerate() {
            if let Some((position, ratio, landmarks)) = *detection {
                let was_pinching = self.pinching[side];
                if self.positions[side].is_some_and(|before| before.distance(position) > 0.15) {
                    disrupted |= 1 << side;
                    self.blocked[side] |= was_pinching;
                    self.previous = None;
                    self.positions[side] = None;
                    self.landmarks[side] = None;
                    self.pinching[side] = false;
                }
                self.pinching[side] = ratio < if self.pinching[side] { 0.35 } else { 0.20 };
                inside[side] = eligible(position);
                if !self.pinching[side] {
                    self.blocked[side] = false;
                } else if !was_pinching && !self.blocked[side] && inside[side] {
                    starts |= 1 << side;
                }
                let position =
                    self.positions[side].map_or(position, |before| before.lerp(position, alpha));
                self.positions[side] = Some(position);
                self.landmarks[side] = Some(self.landmarks[side].map_or(landmarks, |before| {
                    std::array::from_fn(|index| before[index].lerp(landmarks[index], alpha))
                }));
                if self.pinching[side] {
                    mask |= 1 << side;
                }
            } else {
                disrupted |= 1 << side;
                self.blocked[side] = true;
                self.positions[side] = None;
                self.landmarks[side] = None;
                self.pinching[side] = false;
            }
        }
        if self.captured != 0
            && (mask & self.captured != self.captured || disrupted & self.captured != 0)
        {
            self.captured = 0;
            self.previous = None;
            starts = 0;
            for side in 0..2 {
                if self.pinching[side] {
                    self.blocked[side] = true;
                }
            }
        }
        self.captured |= starts;
        let hands = self
            .positions
            .iter()
            .enumerate()
            .filter_map(|(side, position)| {
                position.map(|point| HandCursor {
                    side: if side == 0 { "left" } else { "right" },
                    x: point.x.clamp(0.0, 1.0),
                    y: point.y.clamp(0.0, 1.0),
                    pinching: self.pinching[side],
                    state: if self.captured & (1 << side) != 0 {
                        "active"
                    } else if self.pinching[side] {
                        "release"
                    } else if inside[side] {
                        "ready"
                    } else {
                        "outside"
                    },
                    landmarks: self.landmarks[side].unwrap().map(|point| point.to_array()),
                })
            })
            .collect();
        let mask = self.captured;
        if mask == 0 {
            self.previous = None;
            return HandInputResult {
                hands,
                ..HandInputResult::idle()
            };
        }
        let mut center = self
            .positions
            .iter()
            .enumerate()
            .filter(|(side, _)| mask & (1 << side) != 0)
            .map(|(_, position)| position.unwrap())
            .sum::<Vec2>();
        let both = mask == 3;
        if both {
            center *= 0.5;
        }
        let span = if both {
            ((self.positions[0].unwrap() - self.positions[1].unwrap()) * scale).length()
        } else {
            0.0
        };
        let sample = Sample { mask, center, span };
        let mut result = HandInputResult {
            mode: match mask {
                1 => "pan",
                2 => "rotate",
                _ => "zoom",
            },
            hands,
            zoom: "none",
            commands: Vec::new(),
        };
        if let Some(before) = &self.previous
            && before.mask == mask
        {
            let delta = (center - before.center) * scale;
            if !both && delta.length() > 0.0007 {
                if mask == 1 {
                    result.commands.push(HandCameraCommand::Pan {
                        x: (-delta.x).clamp(-0.04, 0.04),
                        y: delta.y.clamp(-0.04, 0.04),
                    });
                } else {
                    result.commands.push(HandCameraCommand::Rotate {
                        x: (-delta.x * std::f32::consts::TAU).clamp(-0.15, 0.15),
                        y: (delta.y * std::f32::consts::TAU).clamp(-0.15, 0.15),
                    });
                }
            }
            if both && span > 0.04 && before.span > 0.04 {
                let factor = (before.span / span).clamp(0.9, 1.1);
                if (factor - 1.0).abs() > 0.005 {
                    result.zoom = if factor < 1.0 { "in" } else { "out" };
                    result.commands.push(HandCameraCommand::Zoom { factor });
                }
            }
        }
        self.previous = Some(sample);
        result
    }
}
