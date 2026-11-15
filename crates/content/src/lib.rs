pub mod data;
pub mod lessons;

#[cfg(target_arch = "wasm32")]
mod bindings;

#[cfg(target_arch = "wasm32")]
mod lesson_bindings;

#[cfg(target_arch = "wasm32")]
pub use bindings::*;
