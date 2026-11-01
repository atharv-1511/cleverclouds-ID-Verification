"use client";
import React, { useState } from "react";
import { DiditSdk } from "@didit-protocol/sdk-web";

interface VerifyButtonProps {
  vendorData?: string;
  onStatusChange?: (status: string) => void;
  className?: string;
}

export function VerifyButton({ vendorData, onStatusChange, className }: VerifyButtonProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function start() {
    try {
      setLoading(true);
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorData: vendorData || `user_${Date.now()}` }),
      });

      if (!res.ok) {
        throw new Error("Failed to create verification session");
      }

      const { url } = await res.json();

      // Configure SDK completion handler
      DiditSdk.shared.onComplete = (result) => {
        // result.status: "completed" | "cancelled" | "failed" — UI hint only.
        // The webhook is the source of truth for the verification decision.
        console.log("Didit verification flow finished:", result.status);
        setStatus(result.status);
        if (onStatusChange) {
          onStatusChange(result.status);
        }
      };

      // Opens the Didit modal
      DiditSdk.shared.startVerification({ url });
    } catch (err) {
      console.error("Verification initiation error:", err);
      alert("Unable to initialize verification. Please try again or check console.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={start}
      disabled={loading}
      className={className || "verify-button"}
      style={{
        background: "linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)",
        color: "#ffffff",
        border: "none",
        padding: "14px 28px",
        borderRadius: "12px",
        fontSize: "1rem",
        fontWeight: 600,
        cursor: loading ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: "10px",
        boxShadow: "0 10px 25px -5px rgba(99, 102, 241, 0.4)",
        transition: "all 0.3s ease",
      }}
    >
      {loading ? (
        <span>Starting Verification...</span>
      ) : (
        <>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
          <span>Verify Identity with Didit</span>
        </>
      )}
    </button>
  );
}
