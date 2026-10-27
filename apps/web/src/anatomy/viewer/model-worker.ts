import init, { prepare_package_ids } from "../../wasm/wasm";

self.onmessage = async ({ data }) => {
  try {
    await init();
    const prepared = prepare_package_ids(data.packages, data.ids);
    self.postMessage({ prepared }, { transfer: [prepared[0].buffer, prepared[1].buffer] });
  } catch (cause) {
    self.postMessage({ error: cause instanceof Error ? cause.message : String(cause) });
  }
};
