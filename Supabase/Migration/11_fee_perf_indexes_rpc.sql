-- ─────────────────────────────────────────────────────────────────────────────
-- 11_fee_perf_indexes_rpc.sql — Fee module performance + correctness
--
-- WHAT THIS MIGRATION ADDS
-- ───────────────────────
-- 1. record_fee_payment(p_…) — ONE atomic RPC for recording a fee payment.
--
--    WHY: the client previously did a 3-step read-modify-write
--    (INSERT payment → SELECT voucher → UPDATE voucher). Besides the extra
--    round trips, two clerks recording payments on the SAME voucher
--    concurrently could both read paid_amount = X and both write
--    X + their own amount — silently losing the other payment. The RPC does
--    the insert + update inside a single transaction with a row lock
--    (SELECT … FOR UPDATE), so concurrent payments always accumulate
--    correctly.
--
--    The client (src/hooks/useFees.ts → useRecordPayment) calls this RPC
--    FIRST and transparently falls back to the old 3-step flow when the
--    function does not exist (error PGRST202) — so this migration is safe
--    to apply at any time; nothing breaks before or after.
--
-- 2. Indexes on the exact columns the Fees queries filter/aggregate on
--    (each one justified by a real query in src/hooks/useFees.ts):
--
--      fee_vouchers(status)              — useFeeDefaulters  (.in status)
--      fee_vouchers(year)                — useFeeCollectionReport / useClassCollectionSummary (.eq year)
--      fee_vouchers(class)               — vouchers-per-class lists + dashboard breakdown
--      fee_vouchers(student_id)          — useStudentVouchers / useAllVouchersForStudents (.eq/.in)
--      fee_payments(student_id, payment_date) — useFeeDefaulters "last payment date" (.in + ORDER BY payment_date DESC)
--      fee_payments(voucher_id)          — payment history per voucher
--
--    All are plain b-tree indexes; every one backs an existing WHERE /
--    ORDER BY / JOIN path. No unique constraints added, no column changes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Atomic payment recording RPC ─────────────────────────────────────────
create or replace function public.record_fee_payment(
  p_voucher_id      uuid,
  p_student_id      uuid,
  p_amount          numeric,
  p_payment_method  text,
  p_receipt_number  text,
  p_payment_date    date,
  p_received_by     text default null,
  p_notes           text default null
)
returns public.fee_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment   public.fee_payments;
  v_total     numeric;
  v_late      numeric;
  v_paid      numeric;
  v_new_paid  numeric;
  v_status    text;
begin
  -- Amount sanity: refuse zero/negative payments outright.
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  -- Lock the voucher row so concurrent recordings serialise correctly.
  select total_amount, late_fee, paid_amount
    into v_total, v_late, v_paid
  from public.fee_vouchers
  where id = p_voucher_id
  for update;

  if v_total is null then
    raise exception 'Voucher % not found', p_voucher_id;
  end if;

  insert into public.fee_payments (
    voucher_id, student_id, amount, payment_method,
    receipt_number, payment_date, received_by, notes
  ) values (
    p_voucher_id, p_student_id, p_amount, p_payment_method,
    p_receipt_number, p_payment_date, p_received_by, p_notes
  )
  returning * into v_payment;

  v_new_paid := coalesce(v_paid, 0) + p_amount;
  v_status   := case when v_new_paid >= (coalesce(v_total, 0) + coalesce(v_late, 0))
                     then 'paid' else 'partial' end;

  update public.fee_vouchers
     set paid_amount = v_new_paid,
         status      = v_status
   where id = p_voucher_id;

  return v_payment;
end;
$$;

grant execute on function public.record_fee_payment to authenticated, anon;

-- ── 2. Query-path indexes ────────────────────────────────────────────────────
create index if not exists idx_fee_vouchers_status     on public.fee_vouchers (status);
create index if not exists idx_fee_vouchers_year       on public.fee_vouchers (year);
create index if not exists idx_fee_vouchers_class      on public.fee_vouchers (class);
create index if not exists idx_fee_vouchers_student_id on public.fee_vouchers (student_id);
create index if not exists idx_fee_payments_student_date on public.fee_payments (student_id, payment_date desc);
create index if not exists idx_fee_payments_voucher_id   on public.fee_payments (voucher_id);
