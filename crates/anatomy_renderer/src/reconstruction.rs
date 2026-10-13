use crate::{Bounds, Primitive};

#[derive(Default)]
pub struct Reconstruction {
    starts: Vec<f64>,
    time: f64,
    batches: usize,
}

impl Reconstruction {
    pub fn check_time(&self, now: f64) -> Result<(), String> {
        if !now.is_finite() || now < self.time {
            return Err("Invalid reconstruction timestamp".into());
        }
        Ok(())
    }
    pub fn append(
        &mut self,
        parts: &[Primitive],
        bounds: Bounds,
        now: f64,
        animate: bool,
    ) -> Result<(), String> {
        self.check_time(now)?;
        self.time = now;
        let height = (bounds.max.y - bounds.min.y).max(f32::EPSILON);
        for part in parts {
            let start = if animate {
                let level = ((part.bounds.center().y - bounds.min.y) / height).clamp(0.0, 1.0);
                now + level as f64 * 1100.0 + self.batches.min(8) as f64 * 120.0
            } else {
                now - 300.0
            };
            self.starts.push(start);
        }
        self.batches += 1;
        Ok(())
    }
    pub fn opacity(&self, index: usize) -> f32 {
        let t = ((self.time - self.starts[index]) / 300.0).clamp(0.0, 1.0) as f32;
        t * t * (3.0 - 2.0 * t)
    }
    pub fn advance(&mut self, now: f64) -> Result<bool, String> {
        self.check_time(now)?;
        self.time = now;
        Ok(self.starts.iter().any(|start| now < start + 300.0))
    }
    pub fn finish(&mut self) {
        self.starts.fill(self.time - 300.0);
    }
}
