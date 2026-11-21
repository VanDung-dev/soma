import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { readSetting, writeSetting } from "../settings/storage";

export const CameraDevicesContext = createContext<ReturnType<typeof useCameraDevices> | null>(null);

export function useCameraDevices(active = true) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [preferredDevice, setPreferredDevice] = useState(() => {
    const saved = readSetting("camera");
    return typeof saved === "string" ? saved : "";
  });
  const deviceId = devices.some(device => device.deviceId === preferredDevice) ? preferredDevice : "";
  const setDeviceId = (id: string) => {
    setPreferredDevice(id);
    writeSetting("camera", id);
  };
  const [error, setError] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [accessActive, setAccessActive] = useState(false);
  const acquiring = useRef(false);
  const permissionStream = useRef<MediaStream | null>(null);
  const mounted = useRef(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++request.current;
    try {
      const next = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "videoinput" && device.deviceId && !/desk\s*view/i.test(device.label));
      if (!mounted.current || version !== request.current) return;
      setDevices(previous => previous.length === next.length
        && previous.every((device, index) => device.deviceId === next[index]!.deviceId && device.label === next[index]!.label) ? previous : next);
      setError(false);
    } catch {
      if (mounted.current && version === request.current) setError(true);
    }
  }, []);
  const requestAccess = useCallback(async () => {
    if (acquiring.current) return;
    acquiring.current = true;
    setRequesting(true);
    const accessEnded = () => { if (mounted.current) setAccessActive(false); };
    try {
      permissionStream.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      permissionStream.current.getVideoTracks().forEach(track => track.addEventListener("ended", accessEnded));
      if (mounted.current) {
        setAccessActive(permissionStream.current.getVideoTracks().some(track => track.readyState === "live"));
        await refresh();
      }
    } catch {
      if (mounted.current) setError(true);
    } finally {
      permissionStream.current?.getTracks().forEach(track => { track.removeEventListener("ended", accessEnded); track.stop(); });
      permissionStream.current = null;
      acquiring.current = false;
      if (mounted.current) { setAccessActive(false); setRequesting(false); }
    }
  }, [refresh]);
  useEffect(() => {
    if (!active) return;
    mounted.current = true;
    const media = navigator.mediaDevices;
    void refresh();
    media?.addEventListener("devicechange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      mounted.current = false;
      request.current++;
      permissionStream.current?.getTracks().forEach(track => track.stop());
      permissionStream.current = null;
      media?.removeEventListener("devicechange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [active, refresh]);
  return { devices, deviceId, setDeviceId, error, refresh, requesting, requestAccess, accessActive };
}
