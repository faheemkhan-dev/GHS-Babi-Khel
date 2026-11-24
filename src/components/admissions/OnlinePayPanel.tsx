// src/components/admissions/OnlinePayPanel.tsx — processing-fee payment panel:
//   • MANUAL TRANSFER — school accounts + WhatsApp verification message +
//     fee challan download (the school office verifies and marks the fee paid)
// The panel only renders while the processing fee is UNPAID; the parent
// component shows the paid state itself.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Loader2, ShieldCheck, Wallet, Building2, Smartphone, Banknote, ChevronDown, MessageCircle, FileDown, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "react-hot-toast";
import {
  type AdmissionPaymentAccount,
  admissionWhatsappLink,
  describePaymentAccount,
  ensurePaymentReference,
  formatDeadline,
  manualVerifyMessage,
} from "@/lib/admissionPayment";

export interface OnlinePayPanelProps {
  referenceNo: string;
  bFormNo: string;
  processingFee: number;
  paymentReference: string | null;
  feeDeadline: string | null;
  accounts: AdmissionPaymentAccount[];
  whatsappNumber: string | null;
  schoolPhone: string | null;
  /** Called after a payment reference was (re)generated — parent refreshes. */
  onReference?: (paymentReference: string) => void;
  onDownloadChallan?: () => void;
  challanBusy?: boolean;
}

const METHOD_ICON: Record<string, typeof Wallet> = {
  bank: Building2,
  easypaisa: Smartphone,
  jazzcash: Smartphone,
  cash: Banknote,
  other: Wallet,
};

export default function OnlinePayPanel({
  referenceNo, bFormNo, processingFee, paymentReference, feeDeadline,
  accounts, whatsappNumber, schoolPhone, onReference, onDownloadChallan, challanBusy,
}: OnlinePayPanelProps) {
  const [ensuringRef, setEnsuringRef] = useState(false);

  const ensureRef = async (): Promise<string | null> => {
    if (paymentReference) return paymentReference;
    setEnsuringRef(true);
    try {
      const res = await ensurePaymentReference(referenceNo, bFormNo);
      if (!res.ok) {
        toast.error(res.error || "Could not create the payment reference.");
        return null;
      }
      if (res.payment_reference) onReference?.(res.payment_reference);
      return res.payment_reference ?? null;
    } catch (e: any) {
      toast.error(e?.message || "Network problem — try again.");
      return null;
    } finally {
      setEnsuringRef(false);
    }
  };

  const handleGenerateChallan = async () => {
    const ref = await ensureRef();
    if (ref && onDownloadChallan) onDownloadChallan();
  };

  const waLink = admissionWhatsappLink(
    whatsappNumber,
    schoolPhone,
    manualVerifyMessage(processingFee, referenceNo, paymentReference),
  );

  const busy = ensuringRef;

  return (
    <Card className="border-2 border-amber-200 dark:border-amber-900/60">
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
            <CreditCard className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">Processing Fee — Rs {Number(processingFee).toLocaleString("en-PK")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {paymentReference ? (
                <>Payment Reference <span className="font-mono font-bold text-foreground">{paymentReference}</span>
                  {feeDeadline ? <> · pay by <span className="font-medium text-foreground">{formatDeadline(feeDeadline)}</span></> : null}
                </>
              ) : (
                <>Generate your payment reference, then pay by manual transfer.</>
              )}
            </p>
          </div>
        </div>

        {/* MANUAL TRANSFER — always available */}
        <div className="rounded-xl border border-border/70 bg-muted/30 overflow-hidden">
          <p className="px-3.5 pt-3 text-xs font-bold text-foreground">Pay by Manual Transfer</p>
          {(
            <div className="px-3.5 pb-3.5 space-y-3 text-xs">
              <ol className="space-y-1.5 text-muted-foreground list-decimal list-inside">
                <li>Send Rs {Number(processingFee).toLocaleString("en-PK")} to a school account below.</li>
                <li>Send the payment screenshot on WhatsApp with your Reference No.</li>
                <li>The school office verifies it and marks your fee as paid.</li>
              </ol>

              {accounts.length > 0 ? (
                <div className="space-y-2">
                  {accounts.map((acc, i) => {
                    const Icon = METHOD_ICON[acc.type] ?? Wallet;
                    return (
                      <div key={i} className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-card p-2.5">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground leading-snug">{describePaymentAccount(acc)}</p>
                          {acc.type === "bank" && acc.iban && (
                            <button type="button" onClick={() => { navigator.clipboard?.writeText(acc.iban!); toast.success("IBAN copied"); }}
                              className="mt-1 text-[10px] text-primary hover:underline">Copy IBAN</button>
                          )}
                          {(acc.type === "easypaisa" || acc.type === "jazzcash") && acc.phone && (
                            <button type="button" onClick={() => { navigator.clipboard?.writeText(acc.phone!); toast.success("Number copied"); }}
                              className="mt-1 text-[10px] text-primary hover:underline">Copy number</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-muted-foreground italic">
                  Payment account details will be provided by the school office.
                </p>
              )}

              <div className="flex flex-wrap gap-2 pt-0.5">
                {waLink && (
                  <a href={waLink} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-green-600 px-3.5 py-2 text-[11px] font-bold text-white shadow-sm hover:bg-green-700 transition-colors">
                    <MessageCircle className="w-3.5 h-3.5" /> Verify on WhatsApp
                  </a>
                )}
                {onDownloadChallan && (
                  <Button type="button" variant="outline" size="sm" onClick={handleGenerateChallan} disabled={busy || challanBusy}
                    className="h-9 gap-1.5 rounded-full px-3.5 text-[11px] font-bold">
                    {busy || challanBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                    {paymentReference ? "Fee Challan" : "Generate Reference + Challan"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
