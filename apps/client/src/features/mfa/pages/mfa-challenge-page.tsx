import React from "react";
import { MfaChallenge } from "@/features/mfa/components/mfa-challenge";
import { useMfaPageProtection } from "@/features/mfa/hooks/use-mfa-page-protection";

export function MfaChallengePage() {
  const { isValid } = useMfaPageProtection();

  if (!isValid) {
    return null;
  }

  return <MfaChallenge />;
}
