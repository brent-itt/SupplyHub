"use client";

import type { IScannerControls } from "@zxing/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Icon } from "@/components/system/icons";

function cameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was denied. Allow camera access in your browser, or paste the item code below.";
  }

  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No usable camera was found. Connect a camera, or paste the item code below.";
  }

  if (name === "NotReadableError" || name === "AbortError") {
    return "The camera could not start. Close other apps using it and try again, or paste the item code below.";
  }

  return "The camera could not read the code. Try again, or paste the item code below.";
}

export function BarcodeScanner({ onScan, disabled }: { onScan: (value: string) => void; disabled: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const sessionRef = useRef(0);
  const initializingRef = useRef(false);
  const mountedRef = useRef(false);
  const [status, setStatus] = useState<"idle" | "starting" | "scanning">("idle");
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Invalidating the session also cancels pending imports, permission requests,
  // and decode initialization: any late stream/controls are immediately stopped.
  const releaseCamera = useCallback(() => {
    sessionRef.current += 1;
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseCamera();
    };
  }, [releaseCamera]);

  function stopCamera() {
    releaseCamera();
    setStatus("idle");
  }

  function openItem(value: string) {
    stopCamera();
    setError("");
    onScan(value);
    setCode("");
    inputRef.current?.focus();
  }

  async function startCamera() {
    // A permission prompt cannot be aborted. Do not overlap its initialization
    // with another session whose preview the old reader could later clear.
    if (initializingRef.current) return;
    releaseCamera();
    const session = sessionRef.current;
    const video = videoRef.current;
    setError("");

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus("idle");
      setError("Camera scanning needs HTTPS and a supported browser. You can paste the item code below instead.");
      return;
    }

    if (!video) return;
    initializingRef.current = true;
    setInitializing(true);
    setStatus("starting");

    try {
      const { BrowserMultiFormatOneDReader } = await import("@zxing/browser");
      if (session !== sessionRef.current) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });

      if (session !== sessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const reader = new BrowserMultiFormatOneDReader();
      const controls = await reader.decodeFromStream(stream, video, (result, scanError, scanControls) => {
        if (session !== sessionRef.current) {
          scanControls.stop();
          return;
        }

        if (result) {
          scanControls.stop();
          openItem(result.getText());
          return;
        }

        // Incomplete barcode frames are normal while the camera is aiming.
        const kind = scanError?.getKind?.();
        if (scanError && !["NotFoundException", "ChecksumException", "FormatException"].includes(kind ?? "")) {
          scanControls.stop();
          stopCamera();
          setError(cameraError(scanError));
        }
      });

      if (session !== sessionRef.current) {
        controls.stop();
        return;
      }

      controlsRef.current = controls;
      setStatus("scanning");
    } catch (cause) {
      if (session !== sessionRef.current) return;
      stopCamera();
      setError(cameraError(cause));
    } finally {
      initializingRef.current = false;
      if (mountedRef.current) setInitializing(false);
    }
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openItem(code);
  }

  return (
    <section className="pos-scanner" aria-labelledby="scanner-title">
      <div className="pos-scanner-heading"><span className="pos-scanner-icon"><Icon name="scan" size={25}/></span><div><h2 id="scanner-title">Scan a barcode</h2><p>Use a USB scanner, camera, or enter the stock code.</p></div><span className="sys-badge sys-badge-green">Stock out</span></div>

      <video
        ref={videoRef}
        muted
        playsInline
        aria-label="Barcode scanner camera preview"
        style={{
          display: status === "idle" ? "none" : "block",
          width: "100%",
          maxWidth: 600,
          aspectRatio: "4 / 3",
          objectFit: "cover",
          borderRadius: 16,
          background: "#173659",
          marginBlock: 20,
        }}
      />

      <div className="sys-actions" style={{ marginBlock: 20 }}>
        {status === "idle" ? (
          <button type="button" className="sys-button sys-button-secondary" onClick={startCamera} disabled={initializing || disabled}>
            <Icon name="scan" size={17}/> Use camera
          </button>
        ) : (
          <button type="button" className="sys-button sys-button-secondary" onClick={stopCamera}>
            Stop camera
          </button>
        )}
        <p className="sys-muted" role="status" aria-live="polite">
          {status === "starting" && "Waiting for camera access…"}
          {status === "scanning" && "Point at a barcode. The camera stops after one scan to prevent duplicates."}
          {status === "idle" && (initializing
            ? "Camera stopped. Dismiss any open camera permission prompt to start again."
            : "Camera is off.")}
        </p>
      </div>

      {error && <p className="sys-error" role="alert" id="scanner-error">{error}</p>}

      <form className="pos-barcode-form" onSubmit={submitCode}>
        <label className="sys-field" htmlFor="item-code">
          <span>Barcode / stock code</span>
          <input
            ref={inputRef}
            className="sys-input"
            id="item-code"
            name="code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Scan or type a barcode, then press Enter"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={80}
            disabled={disabled || status !== "idle"}
            required
            aria-describedby={error ? "item-code-hint scanner-error" : "item-code-hint"}
          />
        </label>
        <button type="submit" className="sys-button" disabled={disabled || status !== "idle"}><Icon name="plus" size={17}/> Add item</button>
      </form>
      <p className="sys-form-hint" id="item-code-hint">Each scan adds one unit to the cart. Stock updates when you confirm stock out.</p>
    </section>
  );
}
