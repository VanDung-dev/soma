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
                self.pinching[side] = ratio < if self.pinching[side] { 0.55 } else { 0.35 };
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

#[cfg(test)]
mod tests {
    use super::*;

    fn hand(side: f32, x: f32, gap: f32) -> Vec<f32> {
        let mut data = vec![side, 0.99];
        for index in 0..21 {
            data.extend_from_slice(&[
                x + if index == 8 { gap } else { 0.0 },
                if index == 9 { 0.6 } else { 0.4 },
                0.0,
            ]);
        }
        data
    }

    #[test]
    fn sessions_start_inside_the_region_and_require_a_fresh_pinch() {
        let mut input = HandInput::default();
        let region = [0.3, 0.2, 0.7, 0.8];
        for (time, x) in [(0.0, 0.1), (33.0, 0.2), (66.0, 0.3)] {
            let result = input.update_in_region(&hand(0.0, x, 0.01), time, 1.0, &region);
            assert_eq!(result.mode, "idle");
            assert_eq!(result.hands[0].state, "release");
            assert!(result.commands.is_empty());
        }
        let open = input.update_in_region(&hand(0.0, 0.3, 0.45), 99.0, 1.0, &region);
        assert_eq!(open.hands[0].state, "ready");
        let start = input.update_in_region(&hand(0.0, 0.3, 0.01), 132.0, 1.0, &region);
        assert_eq!(start.mode, "pan");
        assert!(start.commands.is_empty());
        let outside = input.update_in_region(&hand(0.0, 0.27, 0.01), 165.0, 1.0, &region);
        assert_eq!(outside.hands[0].state, "active");
        assert!(!outside.commands.is_empty());
        let release = input.update_in_region(&hand(0.0, 0.27, 0.13), 198.0, 1.0, &region);
        assert_eq!(release.mode, "idle");
        assert!(release.commands.is_empty());
    }

    #[test]
    fn panels_block_starts_and_reset_requires_release() {
        let mut input = HandInput::default();
        let region = [0.2, 0.1, 0.8, 0.9, 0.4, 0.3, 0.5, 0.6];
        let blocked = input.update_in_region(&hand(0.0, 0.55, 0.01), 0.0, 1.0, &region);
        assert_eq!(blocked.hands[0].state, "release");
        let moved = input.update_in_region(&hand(0.0, 0.45, 0.01), 33.0, 1.0, &region);
        assert_eq!(moved.mode, "idle");
        input.update_in_region(&hand(0.0, 0.45, 0.13), 66.0, 1.0, &region);
        assert_eq!(
            input
                .update_in_region(&hand(0.0, 0.45, 0.01), 99.0, 1.0, &region)
                .mode,
            "pan"
        );
        input.reset();
        let held = input.update_in_region(&hand(0.0, 0.45, 0.01), 132.0, 1.0, &region);
        assert_eq!(held.mode, "idle");
        assert_eq!(held.hands[0].state, "release");
        input.update_in_region(&hand(0.0, 0.45, 0.13), 165.0, 1.0, &region);
        assert_eq!(
            input
                .update_in_region(&hand(0.0, 0.45, 0.01), 198.0, 1.0, &region)
                .mode,
            "pan"
        );
    }

    #[test]
    fn two_hand_session_ends_when_either_hand_releases_or_is_lost() {
        for lose in [false, true] {
            let mut input = HandInput::default();
            let pair = [hand(0.0, 0.35, 0.01), hand(1.0, 0.65, 0.01)].concat();
            assert_eq!(input.update(&pair, 0.0, 1.0).mode, "zoom");
            let remaining = if lose {
                hand(1.0, 0.65, 0.01)
            } else {
                [hand(0.0, 0.35, 0.13), hand(1.0, 0.65, 0.01)].concat()
            };
            let ended = input.update(&remaining, 33.0, 1.0);
            assert_eq!(ended.mode, "idle");
            assert_eq!(
                ended
                    .hands
                    .iter()
                    .find(|hand| hand.side == "right")
                    .unwrap()
                    .state,
                "release"
            );
            assert!(input.update(&remaining, 66.0, 1.0).commands.is_empty());
        }
    }

    #[test]
    fn second_hand_joins_only_with_a_fresh_pinch_inside_the_region() {
        let mut input = HandInput::default();
        let region = [0.3, 0.2, 0.7, 0.8];
        let pair = |x, gap| [hand(0.0, 0.5, 0.01), hand(1.0, x, gap)].concat();
        assert_eq!(
            input
                .update_in_region(&hand(0.0, 0.5, 0.01), 0.0, 1.0, &region)
                .mode,
            "pan"
        );
        assert_eq!(
            input
                .update_in_region(&pair(0.1, 0.01), 33.0, 1.0, &region)
                .mode,
            "pan"
        );
        for (time, x) in [(66.0, 0.2), (99.0, 0.3), (132.0, 0.4)] {
            assert_eq!(
                input
                    .update_in_region(&pair(x, 0.01), time, 1.0, &region)
                    .mode,
                "pan"
            );
        }
        input.update_in_region(&pair(0.4, 0.13), 165.0, 1.0, &region);
        let joined = input.update_in_region(&pair(0.4, 0.01), 198.0, 1.0, &region);
        assert_eq!(joined.mode, "zoom");
        assert!(joined.commands.is_empty());
        assert!(joined.hands.iter().all(|hand| hand.state == "active"));
    }

    #[test]
    fn malformed_regions_never_start_control() {
        let mut input = HandInput::default();
        for region in [
            vec![],
            vec![0.0; 3],
            vec![0.0, 0.0, f32::NAN, 1.0],
            vec![0.8, 0.0, 0.2, 1.0],
            vec![-0.1, 0.0, 1.0, 1.0],
        ] {
            assert!(
                input
                    .update_in_region(&hand(0.0, 0.4, 0.01), 0.0, 1.0, &region)
                    .hands
                    .is_empty()
            );
        }
        let empty = input.update_in_region(&hand(0.0, 0.4, 0.13), 0.0, 1.0, &[0.0; 4]);
        assert_eq!(empty.hands[0].state, "outside");
    }

    #[test]
    fn right_pinch_rotates_and_release_stops() {
        let mut input = HandInput::default();
        assert!(
            input
                .update(&hand(1.0, 0.4, 0.01), 0.0, 1.0)
                .commands
                .is_empty()
        );
        let result = input.update(&hand(1.0, 0.43, 0.01), 33.0, 1.0);
        assert!(
            matches!(result.commands.as_slice(), [HandCameraCommand::Rotate { x, .. }] if *x > 0.0)
        );
        assert_eq!(input.update(&hand(1.0, 0.43, 0.13), 66.0, 1.0).mode, "idle");
        assert!(
            input
                .update(&hand(1.0, 0.5, 0.01), 99.0, 1.0)
                .commands
                .is_empty()
        );
    }

    #[test]
    fn left_hand_pans_without_rotating_or_zooming() {
        let mut input = HandInput::default();
        let first = input.update(&hand(0.0, 0.4, 0.01), 0.0, 1.0);
        assert_eq!(first.mode, "pan");
        assert!(first.commands.is_empty());
        let mut moved = hand(0.0, 0.43, 0.01);
        for point in moved[2..].chunks_exact_mut(3) {
            point[1] += 0.02;
        }
        let result = input.update(&moved, 33.0, 1.0);
        assert_eq!(result.mode, "pan");
        assert!(
            matches!(result.commands.as_slice(), [HandCameraCommand::Pan { x, y }] if *x > 0.0 && *y > 0.0)
        );
        assert_eq!(result.zoom, "none");
    }

    #[test]
    fn two_hands_only_zoom_independently_of_detection_order() {
        let mut input = HandInput::default();
        let pair = |left, right, reverse| {
            let a = hand(0.0, left, 0.01);
            let b = hand(1.0, right, 0.01);
            if reverse {
                [b, a].concat()
            } else {
                [a, b].concat()
            }
        };
        input.update(&pair(0.3, 0.7, false), 0.0, 1.0);
        let result = input.update(&pair(0.27, 0.73, true), 33.0, 1.0);
        assert_eq!(result.mode, "zoom");
        assert_eq!(result.zoom, "in");
        assert_eq!(
            result
                .hands
                .iter()
                .map(|hand| hand.side)
                .collect::<Vec<_>>(),
            ["left", "right"]
        );
        assert!(
            result
                .commands
                .iter()
                .any(|c| matches!(c, HandCameraCommand::Zoom { factor } if *factor < 1.0))
        );
        assert!(
            result
                .commands
                .iter()
                .all(|command| matches!(command, HandCameraCommand::Zoom { .. }))
        );
        let result = input.update(&pair(0.29, 0.75, false), 66.0, 1.0);
        assert_eq!(result.mode, "zoom");
        assert!(
            result
                .commands
                .iter()
                .all(|command| matches!(command, HandCameraCommand::Zoom { .. }))
        );
        let mut translated = HandInput::default();
        translated.update(&pair(0.3, 0.7, false), 0.0, 1.0);
        assert!(
            translated
                .update(&pair(0.32, 0.72, true), 33.0, 1.0)
                .commands
                .is_empty()
        );
    }

    #[test]
    fn visual_feedback_shows_open_hands_and_clears_lost_or_invalid_tracking() {
        let mut input = HandInput::default();
        let open = input.update(&hand(0.0, 0.4, 0.13), 0.0, 1.0);
        assert_eq!(open.mode, "idle");
        assert_eq!(open.zoom, "none");
        assert_eq!(open.hands.len(), 1);
        assert_eq!(open.hands[0].side, "left");
        assert!(!open.hands[0].pinching);
        assert!((open.hands[0].x - 0.535).abs() < 1e-5);
        assert!((open.hands[0].y - 0.4).abs() < 1e-5);
        let pinched = input.update(&hand(0.0, 0.4, 0.01), 33.0, 1.0);
        assert!(pinched.hands[0].pinching);
        assert_eq!(pinched.mode, "pan");
        assert!(input.update(&[], 66.0, 1.0).hands.is_empty());
        input.update(&hand(0.0, 0.4, 0.01), 99.0, 1.0);
        assert!(input.update(&[f32::NAN; 65], 132.0, 1.0).hands.is_empty());
    }

    #[test]
    fn virtual_hand_landmarks_are_mirrored_smoothed_and_cleared_with_tracking() {
        let mut input = HandInput::default();
        let mut first = hand(0.0, 0.4, 0.01);
        first[28] = -0.05;
        let result = input.update(&first, 0.0, 1.0);
        let pose = result.hands[0].landmarks;
        assert!((pose[0][0] - 0.6).abs() < 1e-5);
        assert!((pose[8][0] - 0.59).abs() < 1e-5);
        assert_eq!(pose[8][2], -0.05);
        let mut moved = hand(0.0, 0.44, 0.01);
        moved[28] = -0.15;
        let result = input.update(&moved, 33.0, 1.0);
        let cursor = &result.hands[0];
        assert!(cursor.landmarks[0][0] > 0.56 && cursor.landmarks[0][0] < 0.6);
        assert!(cursor.landmarks[8][2] > -0.15 && cursor.landmarks[8][2] < -0.05);
        assert!((cursor.x - (cursor.landmarks[4][0] + cursor.landmarks[8][0]) * 0.5).abs() < 1e-5);
        let jumped = input.update(&hand(0.0, 0.9, 0.01), 66.0, 1.0);
        assert!((jumped.hands[0].landmarks[0][0] - 0.1).abs() < 1e-5);
        assert!(input.update(&[], 99.0, 1.0).hands.is_empty());
        let reacquired = input.update(&hand(0.0, 0.2, 0.01), 132.0, 1.0);
        assert!((reacquired.hands[0].landmarks[0][0] - 0.8).abs() < 1e-5);
        input.reset();
        let reset = input.update(&hand(1.0, 0.3, 0.01), 0.0, 1.0);
        assert_eq!(reset.hands[0].side, "right");
        assert!((reset.hands[0].landmarks[0][0] - 0.7).abs() < 1e-5);
        assert!(input.update(&[f32::NAN; 65], 33.0, 1.0).hands.is_empty());
    }

    #[test]
    fn zoom_feedback_matches_the_command_direction() {
        let mut input = HandInput::default();
        let pair = |left, right| [hand(0.0, left, 0.01), hand(1.0, right, 0.01)].concat();
        input.update(&pair(0.3, 0.7), 0.0, 1.0);
        let result = input.update(&pair(0.33, 0.67), 33.0, 1.0);
        assert_eq!(result.zoom, "out");
        assert!(result.commands.iter().any(|command| matches!(command,
            HandCameraCommand::Zoom { factor } if *factor > 1.0)));
        assert_eq!(input.update(&[], 66.0, 1.0).zoom, "none");
    }

    #[test]
    fn tracking_gaps_hand_changes_and_jumps_rebase_without_motion() {
        let mut input = HandInput::default();
        for (time, hands) in [
            (0.0, hand(0.0, 0.3, 0.01)),
            (300.0, hand(0.0, 0.4, 0.01)),
            (333.0, vec![]),
            (366.0, hand(0.0, 0.5, 0.01)),
            (399.0, hand(1.0, 0.5, 0.01)),
            (432.0, hand(1.0, 0.9, 0.01)),
        ] {
            assert!(input.update(&hands, time, 1.0).commands.is_empty());
        }
    }

    #[test]
    fn hysteresis_avoids_pinch_chatter() {
        let mut input = HandInput::default();
        assert_eq!(input.update(&hand(0.0, 0.4, 0.08), 0.0, 1.0).mode, "idle");
        assert_eq!(input.update(&hand(0.0, 0.4, 0.05), 33.0, 1.0).mode, "pan");
        assert_eq!(input.update(&hand(0.0, 0.4, 0.08), 66.0, 1.0).mode, "pan");
        assert_eq!(input.update(&hand(0.0, 0.4, 0.12), 99.0, 1.0).mode, "idle");
    }

    #[test]
    fn invalid_input_and_low_confidence_never_emit_commands() {
        let mut input = HandInput::default();
        let mut low_confidence = hand(0.0, 0.4, 0.01);
        low_confidence[1] = 0.3;
        for invalid in [
            vec![0.0],
            vec![f32::NAN; 65],
            hand(2.0, 0.4, 0.01),
            hand(0.0, 9.0, 0.01),
            [hand(0.0, 0.4, 0.01), hand(0.0, 0.5, 0.01)].concat(),
            low_confidence,
        ] {
            input.reset();
            input.update(&hand(0.0, 0.3, 0.01), 0.0, 1.0);
            assert_eq!(input.update(&invalid, 33.0, 1.0).mode, "idle");
            assert!(
                input
                    .update(&hand(0.0, 0.4, 0.01), 66.0, 1.0)
                    .commands
                    .is_empty()
            );
        }
        for (time, aspect) in [
            (f64::NAN, 1.0),
            (-1.0, 1.0),
            (1.0, f32::INFINITY),
            (1.0, 0.0),
        ] {
            assert_eq!(
                input.update(&hand(0.0, 0.4, 0.01), time, aspect).mode,
                "idle"
            );
        }
    }
}
