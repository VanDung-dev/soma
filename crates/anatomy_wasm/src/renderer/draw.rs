use web_sys::WebGl2RenderingContext as Gl;

use super::AnatomyViewer;

impl AnatomyViewer {
    pub(crate) fn draw_sphere(&self) {
        let gl = &self.gpu.gl;
        let u = &self.sphere_uniforms;
        let matrix = self.camera.matrix();
        gl.use_program(self.gpu.sphere_program.as_ref());
        gl.bind_vertex_array(self.gpu.vaos.first());
        gl.disable(Gl::CULL_FACE);
        gl.enable(Gl::BLEND);
        gl.blend_func_separate(
            Gl::SRC_ALPHA,
            Gl::ONE_MINUS_SRC_ALPHA,
            Gl::ONE,
            Gl::ONE_MINUS_SRC_ALPHA,
        );
        gl.uniform_matrix4fv_with_f32_array(
            Some(&u.inverse),
            false,
            &matrix.inverse().to_cols_array(),
        );
        let bounds = self.scene.bounds;
        let center = bounds.center();
        gl.uniform4f(
            Some(&u.origin),
            center.x,
            center.y,
            center.z,
            self.camera.enclosure_radius(),
        );
        // The enclosure is a backdrop; it never occludes anatomy or participates in picking.
        gl.depth_mask(false);
        gl.draw_arrays(Gl::TRIANGLES, 0, 3);
        gl.depth_mask(true);
        gl.disable(Gl::BLEND);
    }

    pub(crate) fn draw(&self, picking: bool) {
        let gl = &self.gpu.gl;
        if picking {
            self.shadow_cached.set(false);
        } else if !self.shadow_cached.replace(true) {
            // Picking rewrites IDs on demand; reuse its framebuffer for the key light's shadow map.
            gl.bind_framebuffer(Gl::FRAMEBUFFER, self.gpu.framebuffer.as_ref());
            self.draw_pass(false, true);
            gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        }
        self.draw_pass(picking, false);
        if !picking && !self.scene.selected.is_empty() {
            self.draw_outline();
        }
    }

    fn draw_outline(&self) {
        let gl = &self.gpu.gl;
        let u = &self.uniforms;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, self.gpu.outline_framebuffer.as_ref());
        gl.bind_texture(Gl::TEXTURE_2D, None);
        gl.disable(Gl::DEPTH_TEST);
        gl.disable(Gl::CULL_FACE);
        gl.disable(Gl::BLEND);
        gl.clear_color(0.0, 0.0, 0.0, 0.0);
        gl.clear(Gl::COLOR_BUFFER_BIT);
        gl.use_program(self.gpu.program.as_ref());
        gl.uniform_matrix4fv_with_f32_array(
            Some(&u.projection),
            false,
            &self.camera.matrix().to_cols_array(),
        );
        gl.uniform1i(Some(&u.shadow_pass), 0);
        gl.uniform1i(Some(&u.picking), 1);
        gl.uniform3f(Some(&u.pick_color), 1.0, 1.0, 1.0);
        for (i, part) in self.scene.parts.iter().enumerate() {
            if !part.visible || part.source_id != self.scene.selected {
                continue;
            }
            gl.uniform4fv_with_f32_array(Some(&u.color), &part.color);
            gl.uniform1f(Some(&u.cutoff), part.alpha_cutoff);
            gl.uniform1f(Some(&u.reveal), self.reconstruction.opacity(i));
            let (vao, count, offset) = self.draws[i];
            gl.bind_vertex_array(Some(&self.gpu.vaos[vao]));
            gl.draw_elements_with_i32(Gl::TRIANGLES, count, Gl::UNSIGNED_INT, offset);
        }
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        gl.use_program(self.gpu.outline_program.as_ref());
        gl.bind_texture(Gl::TEXTURE_2D, self.gpu.outline_texture.as_ref());
        gl.uniform1i(Some(&self.outline_uniforms.mask), 0);
        let css_width = self.canvas.client_width();
        let ratio = if css_width > 0 {
            self.canvas.width() as f32 / css_width as f32
        } else {
            1.0
        };
        gl.uniform2f(
            Some(&self.outline_uniforms.texel),
            ratio / self.canvas.width() as f32,
            ratio / self.canvas.height() as f32,
        );
        gl.enable(Gl::BLEND);
        gl.blend_func_separate(
            Gl::SRC_ALPHA,
            Gl::ONE_MINUS_SRC_ALPHA,
            Gl::ONE,
            Gl::ONE_MINUS_SRC_ALPHA,
        );
        gl.depth_mask(false);
        gl.draw_arrays(Gl::TRIANGLES, 0, 3);
        gl.depth_mask(true);
        gl.disable(Gl::BLEND);
        gl.bind_texture(Gl::TEXTURE_2D, None);
    }

    fn draw_pass(&self, picking: bool, shadow_pass: bool) {
        let gl = &self.gpu.gl;
        let u = &self.uniforms;
        gl.viewport(
            0,
            0,
            self.canvas.width() as i32,
            self.canvas.height() as i32,
        );
        gl.depth_mask(true);
        gl.enable(Gl::DEPTH_TEST);
        gl.depth_func(Gl::LEQUAL);
        gl.disable(Gl::BLEND);
        gl.disable(Gl::DITHER);
        if shadow_pass {
            gl.clear_color(1.0, 1.0, 1.0, 1.0);
        } else {
            gl.clear_color(0.0, 0.0, 0.0, 0.0);
        }
        gl.clear(Gl::COLOR_BUFFER_BIT | Gl::DEPTH_BUFFER_BIT);
        if !picking && !shadow_pass {
            self.draw_sphere();
        }
        gl.use_program(self.gpu.program.as_ref());
        let light_basis = self.camera.light_basis();
        gl.uniform_matrix3fv_with_f32_array(
            Some(&u.light_basis),
            false,
            &light_basis.to_cols_array(),
        );
        let shadow_projection = self.scene.bounds.shadow_matrix(
            light_basis.x_axis * std::f32::consts::FRAC_1_SQRT_2
                + light_basis.y_axis * 0.5
                + light_basis.z_axis * 0.5,
        );
        gl.uniform_matrix4fv_with_f32_array(
            Some(&u.shadow_projection),
            false,
            &shadow_projection.to_cols_array(),
        );
        gl.uniform1i(Some(&u.shadow_pass), i32::from(shadow_pass));
        gl.uniform1i(Some(&u.shadow_map), 0);
        gl.uniform2f(
            Some(&u.shadow_texel),
            1.0 / self.canvas.width() as f32,
            1.0 / self.canvas.height() as f32,
        );
        gl.active_texture(Gl::TEXTURE0);
        gl.bind_texture(
            Gl::TEXTURE_2D,
            if picking || shadow_pass {
                None
            } else {
                self.gpu.texture.as_ref()
            },
        );
        gl.bind_vertex_array(self.gpu.vaos.first());
        gl.uniform_matrix4fv_with_f32_array(
            Some(&u.projection),
            false,
            &if shadow_pass {
                shadow_projection
            } else {
                self.camera.matrix()
            }
            .to_cols_array(),
        );
        let eye = self.camera.eye();
        gl.uniform3f(Some(&u.eye), eye.x, eye.y, eye.z);
        gl.uniform1i(Some(&u.picking), i32::from(picking));
        let mut order: Vec<_> = self
            .scene
            .parts
            .iter()
            .enumerate()
            .filter(|(i, p)| {
                p.visible && (!shadow_pass || !p.blend) && self.reconstruction.opacity(*i) > 0.0
            })
            .map(|(i, _)| i)
            .collect();
        if !picking && !shadow_pass {
            order.sort_by(|&a, &b| {
                let a = &self.scene.parts[a];
                let b = &self.scene.parts[b];
                a.blend.cmp(&b.blend).then_with(|| {
                    if a.blend {
                        b.bounds
                            .center()
                            .distance_squared(eye)
                            .total_cmp(&a.bounds.center().distance_squared(eye))
                    } else {
                        std::cmp::Ordering::Equal
                    }
                })
            });
        }
        let mut bound_vao = usize::MAX;
        for i in order {
            let p = &self.scene.parts[i];
            if p.double_sided {
                gl.disable(Gl::CULL_FACE);
            } else {
                gl.enable(Gl::CULL_FACE);
                gl.cull_face(Gl::BACK);
            }
            if p.blend && !picking {
                gl.enable(Gl::BLEND);
                gl.blend_func_separate(
                    Gl::SRC_ALPHA,
                    Gl::ONE_MINUS_SRC_ALPHA,
                    Gl::ONE,
                    Gl::ONE_MINUS_SRC_ALPHA,
                );
                gl.depth_mask(false);
            } else {
                gl.disable(Gl::BLEND);
                gl.depth_mask(true);
            }
            gl.uniform4fv_with_f32_array(Some(&u.color), &p.color);
            gl.uniform1f(Some(&u.roughness), p.roughness);
            gl.uniform1f(Some(&u.metallic), p.metallic);
            gl.uniform1f(Some(&u.specular), p.specular);
            gl.uniform1f(Some(&u.subsurface), p.subsurface);
            gl.uniform1f(Some(&u.cutoff), p.alpha_cutoff);
            gl.uniform1i(
                Some(&u.selected),
                i32::from(p.source_id == self.scene.selected),
            );
            let index = i + 1;
            gl.uniform3f(
                Some(&u.pick_color),
                (index & 255) as f32 / 255.0,
                ((index >> 8) & 255) as f32 / 255.0,
                ((index >> 16) & 255) as f32 / 255.0,
            );
            gl.uniform1f(Some(&u.reveal), self.reconstruction.opacity(i));
            let (vao, count, offset) = self.draws[i];
            if bound_vao != vao {
                gl.bind_vertex_array(Some(&self.gpu.vaos[vao]));
                bound_vao = vao;
            }
            gl.draw_elements_with_i32(Gl::TRIANGLES, count, Gl::UNSIGNED_INT, offset);
        }
        gl.depth_mask(true);
        gl.disable(Gl::BLEND);
    }
}
