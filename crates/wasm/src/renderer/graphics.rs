use wasm_bindgen::prelude::*;
use web_sys::WebGl2RenderingContext as Gl;

use super::{AnatomyViewer, util::js_error};

#[wasm_bindgen]
impl AnatomyViewer {
    pub fn resize(&mut self, width: u32, height: u32) -> Result<(), JsValue> {
        self.resize_render_targets(width, height, self.shadow_quality)?;
        self.cancel_camera_transition();
        self.camera.aspect = width as f32 / height as f32;
        self.relayout_explosion()?;
        self.center_camera()?;
        Ok(())
    }

    pub fn set_graphics(
        &mut self,
        shadow_quality: u32,
        lighting_quality: u32,
        show_grid: bool,
        width: u32,
        height: u32,
    ) -> Result<(), JsValue> {
        if shadow_quality > 2 || lighting_quality > 2 {
            return Err(js_error("Invalid graphics quality"));
        }
        if shadow_quality != self.shadow_quality
            || width != self.canvas.width()
            || height != self.canvas.height()
        {
            self.resize_render_targets(width, height, shadow_quality)?;
        }
        self.shadow_quality = shadow_quality;
        self.lighting_quality = lighting_quality;
        self.show_grid = show_grid;
        Ok(())
    }
}

impl AnatomyViewer {
    fn resize_render_targets(
        &mut self,
        width: u32,
        height: u32,
        quality: u32,
    ) -> Result<(), JsValue> {
        let gl = &self.gpu.gl;
        let limit = gl
            .get_parameter(Gl::MAX_RENDERBUFFER_SIZE)?
            .as_f64()
            .unwrap_or(0.0) as u32;
        if width == 0 || height == 0 || width > limit || height > limit {
            return Err(js_error("Invalid viewport dimensions"));
        }
        self.canvas.set_width(width);
        self.shadow_cached.set(false);
        self.canvas.set_height(height);
        gl.bind_texture(Gl::TEXTURE_2D, self.gpu.texture.as_ref());
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_MIN_FILTER, Gl::NEAREST as i32);
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_MAG_FILTER, Gl::NEAREST as i32);
        gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
            Gl::TEXTURE_2D,
            0,
            Gl::RGBA8 as i32,
            width as i32,
            height as i32,
            0,
            Gl::RGBA,
            Gl::UNSIGNED_BYTE,
            None,
        )?;
        gl.bind_renderbuffer(Gl::RENDERBUFFER, self.gpu.depth.as_ref());
        gl.renderbuffer_storage(
            Gl::RENDERBUFFER,
            Gl::DEPTH_COMPONENT24,
            width as i32,
            height as i32,
        );
        gl.bind_framebuffer(Gl::FRAMEBUFFER, self.gpu.framebuffer.as_ref());
        gl.framebuffer_texture_2d(
            Gl::FRAMEBUFFER,
            Gl::COLOR_ATTACHMENT0,
            Gl::TEXTURE_2D,
            self.gpu.texture.as_ref(),
            0,
        );
        gl.framebuffer_renderbuffer(
            Gl::FRAMEBUFFER,
            Gl::DEPTH_ATTACHMENT,
            Gl::RENDERBUFFER,
            self.gpu.depth.as_ref(),
        );
        let complete = gl.check_framebuffer_status(Gl::FRAMEBUFFER) == Gl::FRAMEBUFFER_COMPLETE;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        if !complete || gl.get_error() != Gl::NO_ERROR {
            return Err(js_error("Picking framebuffer allocation failed"));
        }
        gl.bind_texture(Gl::TEXTURE_2D, self.gpu.outline_texture.as_ref());
        for parameter in [Gl::TEXTURE_MIN_FILTER, Gl::TEXTURE_MAG_FILTER] {
            gl.tex_parameteri(Gl::TEXTURE_2D, parameter, Gl::LINEAR as i32);
        }
        for parameter in [Gl::TEXTURE_WRAP_S, Gl::TEXTURE_WRAP_T] {
            gl.tex_parameteri(Gl::TEXTURE_2D, parameter, Gl::CLAMP_TO_EDGE as i32);
        }
        gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
            Gl::TEXTURE_2D,
            0,
            Gl::RGBA8 as i32,
            width as i32,
            height as i32,
            0,
            Gl::RGBA,
            Gl::UNSIGNED_BYTE,
            None,
        )?;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, self.gpu.outline_framebuffer.as_ref());
        gl.framebuffer_texture_2d(
            Gl::FRAMEBUFFER,
            Gl::COLOR_ATTACHMENT0,
            Gl::TEXTURE_2D,
            self.gpu.outline_texture.as_ref(),
            0,
        );
        gl.framebuffer_renderbuffer(
            Gl::FRAMEBUFFER,
            Gl::DEPTH_ATTACHMENT,
            Gl::RENDERBUFFER,
            self.gpu.depth.as_ref(),
        );
        let complete = gl.check_framebuffer_status(Gl::FRAMEBUFFER) == Gl::FRAMEBUFFER_COMPLETE;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        gl.bind_texture(Gl::TEXTURE_2D, None);
        if !complete || gl.get_error() != Gl::NO_ERROR {
            return Err(js_error("Outline framebuffer allocation failed"));
        }
        // Dedicated shadow map: square, decoupled from canvas size so light-space
        // texels stay small even when the viewport is small. Packed RGB depth must
        // be sampled with NEAREST, so resolution (not filtering) carries quality.
        let shadow_size = match quality {
            0 => 1,
            1 => 1024,
            _ => 2048,
        }
        .min(limit);
        gl.bind_texture(Gl::TEXTURE_2D, self.gpu.shadow_texture.as_ref());
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_MIN_FILTER, Gl::NEAREST as i32);
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_MAG_FILTER, Gl::NEAREST as i32);
        for parameter in [Gl::TEXTURE_WRAP_S, Gl::TEXTURE_WRAP_T] {
            gl.tex_parameteri(Gl::TEXTURE_2D, parameter, Gl::CLAMP_TO_EDGE as i32);
        }
        gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
            Gl::TEXTURE_2D,
            0,
            Gl::RGBA8 as i32,
            shadow_size as i32,
            shadow_size as i32,
            0,
            Gl::RGBA,
            Gl::UNSIGNED_BYTE,
            None,
        )?;
        gl.bind_renderbuffer(Gl::RENDERBUFFER, self.gpu.shadow_depth.as_ref());
        gl.renderbuffer_storage(
            Gl::RENDERBUFFER,
            Gl::DEPTH_COMPONENT24,
            shadow_size as i32,
            shadow_size as i32,
        );
        gl.bind_framebuffer(Gl::FRAMEBUFFER, self.gpu.shadow_framebuffer.as_ref());
        gl.framebuffer_texture_2d(
            Gl::FRAMEBUFFER,
            Gl::COLOR_ATTACHMENT0,
            Gl::TEXTURE_2D,
            self.gpu.shadow_texture.as_ref(),
            0,
        );
        gl.framebuffer_renderbuffer(
            Gl::FRAMEBUFFER,
            Gl::DEPTH_ATTACHMENT,
            Gl::RENDERBUFFER,
            self.gpu.shadow_depth.as_ref(),
        );
        let complete = gl.check_framebuffer_status(Gl::FRAMEBUFFER) == Gl::FRAMEBUFFER_COMPLETE;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        gl.bind_texture(Gl::TEXTURE_2D, None);
        if !complete || gl.get_error() != Gl::NO_ERROR {
            return Err(js_error("Shadow framebuffer allocation failed"));
        }
        self.gpu.shadow_size = shadow_size;
        Ok(())
    }
}
