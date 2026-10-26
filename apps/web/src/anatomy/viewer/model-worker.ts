import init, { prepare_packages } from "../../wasm/wasm";

self.onmessage = async ({ data }) => {
  try {
    await init();
    const prepared = prepare_packages(data.packages, data.idsJson);
    self.postMessage({ prepared }, { transfer: [prepared[0].buffer, prepared[1].buffer] });
  } catch (cause) {
    self.postMessage({ error: cause instanceof Error ? cause.message : String(cause) });
  }
};
