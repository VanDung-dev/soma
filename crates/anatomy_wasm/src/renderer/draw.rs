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
        } else if self.shadow_quality > 0 && !self.shadow_cached.replace(true) {
            // Refresh the key light's shadow map on its dedicated framebuffer.
            gl.bind_framebuffer(Gl::FRAMEBUFFER, self.gpu.shadow_framebuffer.as_ref());
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
        let projection = self.camera.matrix();
        let screen_bounds = |index: usize| {
            let bounds = self.scene.parts[index]
                .bounds
                .translated(self.part_offset(index).into());
            let mut rect = [
                f32::INFINITY,
                f32::INFINITY,
                f32::NEG_INFINITY,
                f32::NEG_INFINITY,
            ];
            for x in [bounds.min.x, bounds.max.x] {
                for y in [bounds.min.y, bounds.max.y] {
                    for z in [bounds.min.z, bounds.max.z] {
                        let point = projection.x_axis * x
                            + projection.y_axis * y
                            + projection.z_axis * z
                            + projection.w_axis;
                        if point.w <= 1e-6 {
                            return [
                                f32::NEG_INFINITY,
                                f32::NEG_INFINITY,
                                f32::INFINITY,
                                f32::INFINITY,
                            ];
                        }
                        rect[0] = rect[0].min(point.x / point.w);
                        rect[1] = rect[1].min(point.y / point.w);
                        rect[2] = rect[2].max(point.x / point.w);
                        rect[3] = rect[3].max(point.y / point.w);
                    }
                }
            }
            rect
        };
        let mut region = [
            f32::INFINITY,
            f32::INFINITY,
            f32::NEG_INFINITY,
            f32::NEG_INFINITY,
        ];
        for (i, part) in self.scene.parts.iter().enumerate() {
            if part.visible
                && self.reconstruction.opacity(i) > 0.0
                && (part.source_id == self.scene.selected
                    || part.source_id == self.connection_target)
            {
                let rect = screen_bounds(i);
                region = [
                    region[0].min(rect[0]),
                    region[1].min(rect[1]),
                    region[2].max(rect[2]),
                    region[3].max(rect[3]),
                ];
            }
        }
        if region[0] > region[2] {
            return;
        }
        let margin = 2.0 / self.canvas.width().min(self.canvas.height()).max(1) as f32;
        region = [
            region[0] - margin,
            region[1] - margin,
            region[2] + margin,
            region[3] + margin,
        ];
        gl.bind_framebuffer(Gl::FRAMEBUFFER, self.gpu.outline_framebuffer.as_ref());
        gl.bind_texture(Gl::TEXTURE_2D, None);
        gl.disable(Gl::BLEND);
        gl.clear_color(0.0, 0.0, 0.0, 0.0);
        gl.enable(Gl::DEPTH_TEST);
        gl.depth_func(Gl::LEQUAL);
        gl.depth_mask(true);
        gl.clear(Gl::COLOR_BUFFER_BIT | Gl::DEPTH_BUFFER_BIT);
        gl.use_program(self.gpu.program.as_ref());
        gl.uniform3f(Some(&u.part_offset), 0.0, 0.0, 0.0);
        gl.uniform_matrix4fv_with_f32_array(
            Some(&u.projection),
            false,
            &self.camera.matrix().to_cols_array(),
        );
        gl.uniform1i(Some(&u.shadow_pass), 0);
        gl.uniform1i(Some(&u.picking), 1);
        gl.uniform3f(Some(&u.pick_color), 1.0, 1.0, 1.0);
        let opaque_layout = self.exploding && self.explosion.amount() == 1.0;
        for mask in [false, true] {
            gl.depth_mask(!mask);
            gl.color_mask(mask, mask, mask, mask);
            for (i, part) in self.scene.parts.iter().enumerate() {
                let outlined = part.source_id == self.scene.selected
                    || part.source_id == self.connection_target;
                if self.reconstruction.opacity(i) <= 0.0
                    || if mask {
                        !part.visible || !outlined
                    } else {
                        (!part.visible && !self.reconstruction.fading_out(i))
                            || (part.blend && !opaque_layout)
                    }
                {
                    continue;
                }
                if !mask {
                    let rect = screen_bounds(i);
                    if rect[2] < region[0]
                        || rect[0] > region[2]
                        || rect[3] < region[1]
                        || rect[1] > region[3]
                    {
                        continue;
                    }
                }
                if part.double_sided {
                    gl.disable(Gl::CULL_FACE);
                } else {
                    gl.enable(Gl::CULL_FACE);
                    gl.cull_face(Gl::BACK);
                }
                gl.uniform4fv_with_f32_array(Some(&u.color), &part.color);
                gl.uniform1f(Some(&u.cutoff), part.alpha_cutoff);
                gl.uniform1f(Some(&u.reveal), self.reconstruction.opacity(i));
                gl.uniform3fv_with_f32_array(Some(&u.part_offset), &self.part_offset(i));
                let (vao, count, offset) = self.draws[i];
                gl.bind_vertex_array(Some(&self.gpu.vaos[vao]));
                gl.draw_elements_with_i32(Gl::TRIANGLES, count, Gl::UNSIGNED_INT, offset);
            }
        }
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        gl.disable(Gl::DEPTH_TEST);
        gl.disable(Gl::CULL_FACE);
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
        let separation = if self.exploding {
            self.explosion.amount()
        } else {
            0.0
        };
        let opaque_layout = separation == 1.0;
        if shadow_pass {
            let size = self.gpu.shadow_size.max(1) as i32;
            gl.viewport(0, 0, size, size);
        } else {
            gl.viewport(
                0,
                0,
                self.canvas.width() as i32,
                self.canvas.height() as i32,
            );
        }
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
        if !picking && !shadow_pass && self.show_grid {
            self.draw_sphere();
        }
        gl.use_program(self.gpu.program.as_ref());
        gl.uniform3f(Some(&u.part_offset), 0.0, 0.0, 0.0);
        let light_basis = self.camera.light_basis();
        gl.uniform_matrix3fv_with_f32_array(
            Some(&u.light_basis),
            false,
            &light_basis.to_cols_array(),
        );
        let shadow_projection = {
            let light = light_basis.x_axis * std::f32::consts::FRAC_1_SQRT_2
                + light_basis.y_axis * 0.5
                + light_basis.z_axis * 0.5;
            // Fit the frustum to the viewed region so zoomed-in texels stay dense.
            let (center, radius) = self.camera.shadow_volume();
            gl.uniform1f(Some(&u.shadow_offset), radius * 1e-3);
            anatomy_renderer::Bounds::shadow_matrix_at(center, radius, light)
        };
        gl.uniform_matrix4fv_with_f32_array(
            Some(&u.shadow_projection),
            false,
            &shadow_projection.to_cols_array(),
        );
        gl.uniform1i(Some(&u.shadow_pass), i32::from(shadow_pass));
        gl.uniform1i(Some(&u.shadow_quality), self.shadow_quality as i32);
        gl.uniform1i(Some(&u.lighting_quality), self.lighting_quality as i32);
        gl.uniform1i(Some(&u.shadow_map), 0);
        let shadow_texel = 1.0 / self.gpu.shadow_size.max(1) as f32;
        gl.uniform2f(Some(&u.shadow_texel), shadow_texel, shadow_texel);
        gl.active_texture(Gl::TEXTURE0);
        gl.bind_texture(
            Gl::TEXTURE_2D,
            if picking || shadow_pass {
                None
            } else {
                self.gpu.shadow_texture.as_ref()
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
                (p.visible || (!picking && self.reconstruction.fading_out(*i)))
                    && (!shadow_pass || !p.blend || opaque_layout)
                    && self.reconstruction.opacity(*i) > 0.0
            })
            .map(|(i, _)| i)
            .collect();
        if !picking && !shadow_pass && !opaque_layout {
            order.sort_by(|&a_index, &b_index| {
                let a = &self.scene.parts[a_index];
                let b = &self.scene.parts[b_index];
                a.blend.cmp(&b.blend).then_with(|| {
                    if a.blend {
                        let a_center = a
                            .bounds
                            .translated(self.part_offset(a_index).into())
                            .center();
                        let b_center = b
                            .bounds
                            .translated(self.part_offset(b_index).into())
                            .center();
                        b_center
                            .distance_squared(eye)
                            .total_cmp(&a_center.distance_squared(eye))
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
            if p.blend && !opaque_layout && !picking {
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
            let mut color = p.color;
            // Separate tissue becomes readable without changing its source material on reassembly.
            if p.blend && color[3] > 0.0 {
                color[3] += (1.0 - color[3]) * separation;
            }
            gl.uniform4fv_with_f32_array(Some(&u.color), &color);
            gl.uniform1f(Some(&u.roughness), p.roughness);
            gl.uniform1f(Some(&u.metallic), p.metallic);
            gl.uniform1f(Some(&u.specular), p.specular);
            gl.uniform1f(Some(&u.subsurface), p.subsurface);
            gl.uniform1f(Some(&u.cutoff), p.alpha_cutoff);
            gl.uniform1i(
                Some(&u.selected),
                i32::from(
                    p.source_id == self.scene.selected || p.source_id == self.connection_target,
                ),
            );
            let index = i + 1;
            gl.uniform3f(
                Some(&u.pick_color),
                (index & 255) as f32 / 255.0,
                ((index >> 8) & 255) as f32 / 255.0,
                ((index >> 16) & 255) as f32 / 255.0,
            );
            gl.uniform1f(Some(&u.reveal), self.reconstruction.opacity(i));
            gl.uniform3fv_with_f32_array(Some(&u.part_offset), &self.part_offset(i));
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
