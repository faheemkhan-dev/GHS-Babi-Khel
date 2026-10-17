-- ═══════════════════════════════════════════════════════════════════════
-- FILE 05 — Row-Level Security Policies, Triggers & Functions
-- ═══════════════════════════════════════════════════════════════════════
-- This is the SECURITY & BUSINESS-LOGIC layer. Every CREATE POLICY,
-- CREATE FUNCTION and CREATE TRIGGER on a public.* table lives here.
--
-- Run LAST — after all four table files (01-04) — because policies and
-- triggers reference tables that must already exist.
--
-- A school reviewing / auditing their deployment should read THIS file
-- carefully: it controls who can read / write / delete what. The table
-- files only define structure.
--
-- LAYERS (in dependency order):
--   1. Helper / utility functions (e.g. normalize_phone)
--   2. RPC functions called by the frontend (verify_admission_otp, etc.)
--   3. Trigger functions (called by triggers when rows change)
--   4. CREATE TRIGGER statements (wire events to trigger functions)
--   5. CREATE POLICY statements (gate SELECT / INSERT / UPDATE / DELETE)
-- ═══════════════════════════════════════════════════════════════════════


CREATE FUNCTION public.admin_delete_user(target_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- 1. Verify the caller is an admin (using EXISTS, not SELECT INTO)
    IF NOT EXISTS (
        SELECT 1 FROM profiles
            WHERE id = auth.uid() AND role = 'admin'
              ) THEN
                  RAISE EXCEPTION 'Permission denied: only admins can delete users';
                    END IF;

                      -- 2. Refuse to delete yourself (safety check)
                        IF target_user_id = auth.uid() THEN
                            RAISE EXCEPTION 'Cannot delete your own account';
                              END IF;

                                -- 3. Clean up related rows in teachers BEFORE deleting from auth.users.
                                  --    This avoids FK constraint violations if teachers.user_id doesn't cascade.
                                    DELETE FROM teachers WHERE user_id = target_user_id;

                                      -- 4. For students: set user_id to NULL instead of deleting the student
                                        --    record (preserves historical attendance/results/fees). If the
                                          --    students table doesn't have a user_id column, this silently does
                                            --    nothing thanks to the EXCEPTION handler.
                                              BEGIN
                                                  UPDATE students SET user_id = NULL WHERE user_id = target_user_id;
                                                    EXCEPTION WHEN OTHERS THEN
                                                        -- Column doesn't exist or other issue — ignore, proceed to delete
                                                            NULL;
                                                              END;

                                                                -- 5. Delete from auth.users. This CASCADES to profiles (via the FK
                                                                  --    profiles.id → auth.users.id) so the profile row is removed too.
                                                                    --    This also removes the user from Supabase Auth entirely, freeing
                                                                      --    up the email for re-registration.
                                                                        --
                                                                          --    If the auth.users row is already gone (orphaned profile), this
                                                                            --    DELETE affects 0 rows — no error. We also clean up any lingering
                                                                              --    profile row just in case.
                                                                                DELETE FROM auth.users WHERE id = target_user_id;
                                                                                  DELETE FROM profiles WHERE id = target_user_id;
                                                                                  END;
                                                                                  $$;





CREATE FUNCTION public.auto_link_student_user_id() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                                                                                                                                                                                                            BEGIN
                                                                                                                                                                                                                                                                                              -- Only try to link if user_id is not already set
                                                                                                                                                                                                                                                                                                IF NEW.user_id IS NULL THEN
                                                                                                                                                                                                                                                                                                    -- Find the profile that matches this student's name and class
                                                                                                                                                                                                                                                                                                        SELECT id INTO NEW.user_id
                                                                                                                                                                                                                                                                                                            FROM profiles
                                                                                                                                                                                                                                                                                                                WHERE role = 'student'
                                                                                                                                                                                                                                                                                                                      AND class = NEW.class
                                                                                                                                                                                                                                                                                                                            AND full_name ILIKE NEW.full_name
                                                                                                                                                                                                                                                                                                                                  AND id IN (SELECT id FROM auth.users)
                                                                                                                                                                                                                                                                                                                                      LIMIT 1;
                                                                                                                                                                                                                                                                                                                                        END IF;
                                                                                                                                                                                                                                                                                                                                          RETURN NEW;
                                                                                                                                                                                                                                                                                                                                          END;
                                                                                                                                                                                                                                                                                                                                          $$;





CREATE FUNCTION public.book_interview_slot(p_admission_id uuid, p_slot_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slot        record;
  v_existing    record;
  v_admission   record;
  v_new_status  public.admission_status;
  v_note        text;
begin
  select * into v_slot from public.interview_slots where id = p_slot_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Slot not found.');
  end if;

  if v_slot.slot_date < current_date then
    return jsonb_build_object('success', false, 'error', 'This slot is in the past.');
  end if;

  select * into v_existing
    from public.interview_bookings
   where admission_id = p_admission_id
     and cancelled_at is null
   limit 1;
  if found then
    return jsonb_build_object(
      'success', false,
      'error', 'You already have an interview booked. Cancel it first to rebook.',
      'existing_slot_id', v_existing.slot_id
    );
  end if;

  select * into v_admission from public.admissions where id = p_admission_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Application not found.');
  end if;

  -- Capacity check → waitlist if full
  if v_slot.current_bookings >= v_slot.capacity then
    update public.admissions
       set status = 'waitlisted'::public.admission_status
     where id = p_admission_id;

    insert into public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
    values (
      p_admission_id,
      v_admission.status::public.admission_status,
      'waitlisted'::public.admission_status,
      'Added to waitlist — slot ' || to_char(v_slot.slot_date, 'DD Mon') || ' ' || v_slot.start_time || ' was full.',
      'system'
    );

    perform public.notify_applicant_sms(
      v_admission.contact_number,
      'You have been added to the waitlist for an interview slot. We will notify you when a seat opens up.'
    );

    return jsonb_build_object(
      'success', true,
      'waitlisted', true,
      'message', 'This slot is full. You have been added to the waitlist.'
    );
  end if;

  -- Book the slot
  insert into public.interview_bookings (admission_id, slot_id)
  values (p_admission_id, p_slot_id);

  update public.interview_slots
     set current_bookings = current_bookings + 1
   where id = p_slot_id;

  v_new_status := 'interview_scheduled'::public.admission_status;
  v_note := 'Interview scheduled for ' || to_char(v_slot.slot_date, 'DD Mon YYYY') || ' at ' || v_slot.start_time ||
            coalesce(' — ' || v_slot.location, '');

  update public.admissions set status = v_new_status where id = p_admission_id;

  insert into public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
  values (
    p_admission_id,
    v_admission.status::public.admission_status,
    v_new_status,
    v_note,
    'applicant'
  );

  perform public.notify_applicant_sms(
    v_admission.contact_number,
    'Your interview is scheduled for ' || to_char(v_slot.slot_date, 'DD Mon YYYY') || ' at ' || v_slot.start_time ||
    coalesce(' — ' || v_slot.location, '') || '. Reference: ' || v_admission.reference_no
  );

  return jsonb_build_object(
    'success', true,
    'waitlisted', false,
    'slot_date', v_slot.slot_date,
    'slot_time', v_slot.start_time,
    'location', v_slot.location
  );
end;
$$;





CREATE FUNCTION public.cancel_interview_booking(p_admission_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                                                                                     declare
                                                                                                                                                                       v_booking       record;
                                                                                                                                                                         v_admission     record;
                                                                                                                                                                           v_promoted_id   uuid;
                                                                                                                                                                             v_promoted_name text;
                                                                                                                                                                             begin
                                                                                                                                                                               select * into v_booking
                                                                                                                                                                                   from public.interview_bookings
                                                                                                                                                                                      where admission_id = p_admission_id
                                                                                                                                                                                           and cancelled_at is null
                                                                                                                                                                                              for update;

                                                                                                                                                                                                if not found then
                                                                                                                                                                                                    return jsonb_build_object('success', false, 'error', 'No active booking found.');
                                                                                                                                                                                                      end if;

                                                                                                                                                                                                        -- Cancel
                                                                                                                                                                                                          update public.interview_bookings
                                                                                                                                                                                                               set cancelled_at = now()
                                                                                                                                                                                                                  where id = v_booking.id;

                                                                                                                                                                                                                    -- Decrement slot counter
                                                                                                                                                                                                                      update public.interview_slots
                                                                                                                                                                                                                           set current_bookings = greatest(0, current_bookings - 1)
                                                                                                                                                                                                                              where id = v_booking.slot_id;

                                                                                                                                                                                                                                -- Fetch admission to get applying_class + previous status
                                                                                                                                                                                                                                  select * into v_admission from public.admissions where id = p_admission_id;
                                                                                                                                                                                                                                    if not found then
                                                                                                                                                                                                                                        return jsonb_build_object('success', false, 'error', 'Application not found.');
                                                                                                                                                                                                                                          end if;

                                                                                                                                                                                                                                            -- Add timeline entry
                                                                                                                                                                                                                                              insert into public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
                                                                                                                                                                                                                                                values (p_admission_id, v_admission.status, 'under_review'::public.admission_status,
                                                                                                                                                                                                                                                          'Interview booking cancelled by applicant.', 'applicant');

                                                                                                                                                                                                                                                            -- Update status back to under_review
                                                                                                                                                                                                                                                              update public.admissions set status = 'under_review' where id = p_admission_id;

                                                                                                                                                                                                                                                                -- Auto-promote: find next waitlisted applicant for the same class
                                                                                                                                                                                                                                                                  -- (ordered by application date — first come, first served)
                                                                                                                                                                                                                                                                    select a.id, a.full_name into v_promoted_id, v_promoted_name
                                                                                                                                                                                                                                                                        from public.admissions a
                                                                                                                                                                                                                                                                           where a.applying_class = v_admission.applying_class
                                                                                                                                                                                                                                                                                and a.status = 'waitlisted'::public.admission_status
                                                                                                                                                                                                                                                                                   order by a.created_at asc
                                                                                                                                                                                                                                                                                      limit 1
                                                                                                                                                                                                                                                                                         for update of a;

                                                                                                                                                                                                                                                                                           if v_promoted_id is not null then
                                                                                                                                                                                                                                                                                               update public.admissions
                                                                                                                                                                                                                                                                                                      set status = 'interview_scheduled'::public.admission_status
                                                                                                                                                                                                                                                                                                           where id = v_promoted_id;

                                                                                                                                                                                                                                                                                                               insert into public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
                                                                                                                                                                                                                                                                                                                   values (v_promoted_id, 'waitlisted'::public.admission_status,
                                                                                                                                                                                                                                                                                                                               'interview_scheduled'::public.admission_status,
                                                                                                                                                                                                                                                                                                                                           'A seat opened up — you have been auto-promoted from the waitlist! Please book your interview slot.',
                                                                                                                                                                                                                                                                                                                                                       'system');
                                                                                                                                                                                                                                                                                                                                                         end if;

                                                                                                                                                                                                                                                                                                                                                           return jsonb_build_object(
                                                                                                                                                                                                                                                                                                                                                               'success', true,
                                                                                                                                                                                                                                                                                                                                                                   'promoted_applicant_id', v_promoted_id::text,
                                                                                                                                                                                                                                                                                                                                                                       'promoted_applicant_name', v_promoted_name
                                                                                                                                                                                                                                                                                                                                                                         );
                                                                                                                                                                                                                                                                                                                                                                         end;
                                                                                                                                                                                                                                                                                                                                                                         $$;





CREATE FUNCTION public.cast_poll_vote(p_notice_id uuid, p_option_id text, p_voter_token text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
                                                    declare
                                                      v_notice      public.notices%rowtype;
                                                        v_options     jsonb;
                                                          v_option_ok   boolean := false;
                                                            v_opt         jsonb;
                                                              v_updated     jsonb := '[]'::jsonb;
                                                              begin
                                                                if p_voter_token is null or length(trim(p_voter_token)) < 8 then
                                                                    raise exception 'invalid voter token';
                                                                      end if;

                                                                        select * into v_notice from public.notices where id = p_notice_id for update;
                                                                          if not found then
                                                                              raise exception 'notice not found';
                                                                                end if;
                                                                                  if not v_notice.is_poll then
                                                                                      raise exception 'this notice is not a poll';
                                                                                        end if;
                                                                                          if not v_notice.is_published then
                                                                                              raise exception 'this poll is not published';
                                                                                                end if;
                                                                                                  if v_notice.poll_closes_at is not null and v_notice.poll_closes_at <= now() then
                                                                                                      raise exception 'this poll is closed';
                                                                                                        end if;

                                                                                                          v_options := v_notice.poll_options;
                                                                                                            for v_opt in select * from jsonb_array_elements(v_options)
                                                                                                              loop
                                                                                                                  if v_opt->>'id' = p_option_id then
                                                                                                                        v_option_ok := true;
                                                                                                                            end if;
                                                                                                                              end loop;
                                                                                                                                if not v_option_ok then
                                                                                                                                    raise exception 'invalid poll option';
                                                                                                                                      end if;

                                                                                                                                        -- The unique constraint on (notice_id, voter_token) is the real guard —
                                                                                                                                          -- if this device already has a row for this poll, the insert raises
                                                                                                                                            -- unique_violation and we turn that into a clean "already voted" error
                                                                                                                                              -- instead of a raw Postgres error leaking to the client.
                                                                                                                                                begin
                                                                                                                                                    insert into public.poll_votes (notice_id, option_id, voter_token)
                                                                                                                                                        values (p_notice_id, p_option_id, p_voter_token);
                                                                                                                                                          exception when unique_violation then
                                                                                                                                                              raise exception 'already voted';
                                                                                                                                                                end;

                                                                                                                                                                  -- Increment the matching option's counter inside the same locked row.
                                                                                                                                                                    for v_opt in select * from jsonb_array_elements(v_options)
                                                                                                                                                                      loop
                                                                                                                                                                          if v_opt->>'id' = p_option_id then
                                                                                                                                                                                v_opt := jsonb_set(v_opt, '{votes}', to_jsonb(coalesce((v_opt->>'votes')::int, 0) + 1));
                                                                                                                                                                                    end if;
                                                                                                                                                                                        v_updated := v_updated || jsonb_build_array(v_opt);
                                                                                                                                                                                          end loop;

                                                                                                                                                                                            update public.notices set poll_options = v_updated where id = p_notice_id;

                                                                                                                                                                                              return jsonb_build_object('options', v_updated, 'voted_option_id', p_option_id);
                                                                                                                                                                                              end;
                                                                                                                                                                                              $$;





CREATE FUNCTION public.create_my_profile(p_full_name text, p_role text, p_phone text, p_status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF p_full_name IS NULL OR trim(p_full_name) = '' THEN
    RAISE EXCEPTION 'Name required';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('student', 'teacher', 'admin') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  INSERT INTO public.profiles (
    id, full_name, role, phone, status, email_verified, created_at, updated_at
  ) VALUES (
    auth.uid(),
    trim(p_full_name),
    p_role,
    CASE WHEN p_phone IS NOT NULL AND trim(p_phone) != '' THEN trim(p_phone) ELSE NULL END,
    COALESCE(p_status, 'pending'),
    false,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    phone = EXCLUDED.phone,
    status = EXCLUDED.status,
    updated_at = now();
END;
$$;





CREATE FUNCTION public.custom_access_token_hook(event jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  claims jsonb;
    user_role text;
    BEGIN
      -- Get the user's role from profiles table
        SELECT role INTO user_role
          FROM public.profiles
            WHERE id = (event->>'user_id')::uuid;

              -- Get existing claims
                claims := event->'claims';

                  -- Inject user_role into claims (defaults to 'student' if not found)
                    IF user_role IS NOT NULL THEN
                        claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
                          ELSE
                              claims := jsonb_set(claims, '{user_role}', '"student"');
                                END IF;

                                  -- Return modified event
                                    RETURN jsonb_set(event, '{claims}', claims);
                                    END;
                                    $$;





CREATE FUNCTION public.dismiss_all_notifications() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                  BEGIN
                                                                                                    INSERT INTO notification_dismissals (user_id, notification_id)
                                                                                                      SELECT auth.uid(), n.id
                                                                                                        FROM notifications n
                                                                                                          WHERE NOT EXISTS (
                                                                                                              SELECT 1 FROM notification_dismissals d
                                                                                                                  WHERE d.notification_id = n.id AND d.user_id = auth.uid()
                                                                                                                    )
                                                                                                                      AND (
                                                                                                                          n.audience = 'all'
                                                                                                                              OR (n.audience = 'admin' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
                                                                                                                                  OR (n.audience = 'students' AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
                                                                                                                                      OR n.audience LIKE 'class:%' AND n.audience = 'class:' || (SELECT class FROM profiles WHERE id = auth.uid())
                                                                                                                                          OR n.audience LIKE 'user:%' AND n.audience = 'user:' || auth.uid()::text
                                                                                                                                            )
                                                                                                                                              ON CONFLICT DO NOTHING;
                                                                                                                                              END;
                                                                                                                                              $$;





CREATE FUNCTION public.dismiss_notification(p_notification_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                                                                                                                                                                                                                                                  DECLARE
                                                                                                                                                                                                                                                                                                                                    v_visible boolean;
                                                                                                                                                                                                                                                                                                                                    BEGIN
                                                                                                                                                                                                                                                                                                                                      SELECT EXISTS (
                                                                                                                                                                                                                                                                                                                                          SELECT 1 FROM notifications n
                                                                                                                                                                                                                                                                                                                                              WHERE n.id = p_notification_id
                                                                                                                                                                                                                                                                                                                                                    AND (
                                                                                                                                                                                                                                                                                                                                                            n.audience = 'all'
                                                                                                                                                                                                                                                                                                                                                                    OR (n.audience = 'admin' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
                                                                                                                                                                                                                                                                                                                                                                            OR (n.audience = 'students' AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
                                                                                                                                                                                                                                                                                                                                                                                    OR (n.audience LIKE 'class:%' AND n.audience = 'class:' || (SELECT class FROM profiles WHERE id = auth.uid()))
                                                                                                                                                                                                                                                                                                                                                                                            OR (n.audience LIKE 'user:%' AND n.audience = 'user:' || auth.uid()::text)
                                                                                                                                                                                                                                                                                                                                                                                                    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')  -- admins can dismiss anything
                                                                                                                                                                                                                                                                                                                                                                                                          )
                                                                                                                                                                                                                                                                                                                                                                                                            ) INTO v_visible;

                                                                                                                                                                                                                                                                                                                                                                                                              IF NOT v_visible THEN
                                                                                                                                                                                                                                                                                                                                                                                                                  RAISE EXCEPTION 'Notification not found or not visible to current user';
                                                                                                                                                                                                                                                                                                                                                                                                                    END IF;

                                                                                                                                                                                                                                                                                                                                                                                                                      INSERT INTO notification_dismissals (user_id, notification_id)
                                                                                                                                                                                                                                                                                                                                                                                                                        VALUES (auth.uid(), p_notification_id)
                                                                                                                                                                                                                                                                                                                                                                                                                          ON CONFLICT (user_id, notification_id) DO NOTHING;
                                                                                                                                                                                                                                                                                                                                                                                                                          END;
                                                                                                                                                                                                                                                                                                                                                                                                                          $$;





CREATE FUNCTION public.enrol_srs_on_wrong_answer() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                          BEGIN
                                                                            INSERT INTO public.srs_reviews (
                                                                                user_id,
                                                                                    question_id,
                                                                                        ease_factor,
                                                                                            interval,
                                                                                                repetitions,
                                                                                                    next_review_date
                                                                                                      )
                                                                                                        VALUES (
                                                                                                            NEW.user_id,
                                                                                                                NEW.question_id,
                                                                                                                    2.5,
                                                                                                                        1,
                                                                                                                            0,
                                                                                                                                (CURRENT_DATE + INTERVAL '1 day')::date
                                                                                                                                  )
                                                                                                                                    ON CONFLICT (user_id, question_id) DO NOTHING;  -- already enrolled, don't reset progress

                                                                                                                                      RETURN NEW;
                                                                                                                                      END;
                                                                                                                                      $$;





CREATE FUNCTION public.fn_notify(p_audience text, p_type text, p_title text, p_body text DEFAULT NULL::text, p_link text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
            BEGIN
              INSERT INTO notifications (audience, type, title, body, link, actor_id)
                VALUES (p_audience, p_type, p_title, p_body, p_link, p_actor_id);
                END;
                $$;





CREATE FUNCTION public.fn_recent_notification_exists(p_type text, p_audience text, p_title_prefix text, p_window_secs integer DEFAULT 60) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM notifications
    WHERE type = p_type
      AND audience = p_audience
      AND title LIKE p_title_prefix || '%'
      AND created_at > now() - (p_window_secs || ' seconds')::interval
  );
END;
$$;





CREATE FUNCTION public.fn_student_records_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
                                                                              BEGIN
                                                                                NEW.updated_at = now();
                                                                                  RETURN NEW;
                                                                                  END;
                                                                                  $$;





CREATE FUNCTION public.generate_admission_reference() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
                                                                                      declare
                                                                                        yr text := to_char(now(), 'YYYY');
                                                                                          seq int;
                                                                                          begin
                                                                                            if new.reference_no is null or new.reference_no = '' then
                                                                                                select count(*) + 1 into seq from public.admissions
                                                                                                      where reference_no like 'OHS-' || yr || '-%';
                                                                                                          new.reference_no := 'OHS-' || yr || '-' || lpad(seq::text, 4, '0');
                                                                                                            end if;
                                                                                                              return new;
                                                                                                              end;
                                                                                                              $$;





CREATE FUNCTION public.get_admin_stats() RETURNS TABLE(total_students bigint, total_teachers bigint, total_notices bigint, total_news bigint, total_library bigint, total_albums bigint, total_users bigint, total_achievements bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.students)::BIGINT,
    (SELECT COUNT(*) FROM public.teachers)::BIGINT,
    (SELECT COUNT(*) FROM public.notices)::BIGINT,
    (SELECT COUNT(*) FROM public.news)::BIGINT,
    (SELECT COUNT(*) FROM public.library_files)::BIGINT,
    (SELECT COUNT(*) FROM public.gallery_albums)::BIGINT,
    (SELECT COUNT(*) FROM public.profiles)::BIGINT,
    (SELECT COUNT(*) FROM public.achievements)::BIGINT;
END;
$$;





CREATE FUNCTION public.get_all_fee_structures() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
                                                                                                                                                                                                                                                          begin
                                                                                                                                                                                                                                                            if auth.uid() is null then
                                                                                                                                                                                                                                                                return jsonb_build_object('success', false, 'error', 'Not authenticated', 'structures', '[]'::jsonb);
                                                                                                                                                                                                                                                                  end if;

                                                                                                                                                                                                                                                                    return jsonb_build_object(
                                                                                                                                                                                                                                                                        'success', true,
                                                                                                                                                                                                                                                                            'structures', coalesce((
                                                                                                                                                                                                                                                                                  select jsonb_agg(jsonb_build_object(
                                                                                                                                                                                                                                                                                          'id', fs.id,
                                                                                                                                                                                                                                                                                                  'class', fs.class,
                                                                                                                                                                                                                                                                                                          'fee_type', fs.fee_type,
                                                                                                                                                                                                                                                                                                                  'label', fs.label,
                                                                                                                                                                                                                                                                                                                          'amount', fs.amount,
                                                                                                                                                                                                                                                                                                                                  'is_optional', fs.is_optional,
                                                                                                                                                                                                                                                                                                                                          'is_recurring', fs.is_recurring,
                                                                                                                                                                                                                                                                                                                                                  'frequency', fs.frequency,
                                                                                                                                                                                                                                                                                                                                                          'is_active', fs.is_active,
                                                                                                                                                                                                                                                                                                                                                                  'created_at', fs.created_at,
                                                                                                                                                                                                                                                                                                                                                                          'updated_at', fs.updated_at
                                                                                                                                                                                                                                                                                                                                                                                ) order by fs.class, fs.fee_type)
                                                                                                                                                                                                                                                                                                                                                                                      from public.fee_structures fs
                                                                                                                                                                                                                                                                                                                                                                                           where fs.is_active = true
                                                                                                                                                                                                                                                                                                                                                                                               ), '[]'::jsonb)
                                                                                                                                                                                                                                                                                                                                                                                                 );
                                                                                                                                                                                                                                                                                                                                                                                                 end;
                                                                                                                                                                                                                                                                                                                                                                                                 $$;





CREATE FUNCTION public.get_all_vouchers() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null then
      return jsonb_build_object('success', false, 'error', 'Not authenticated', 'vouchers', '[]'::jsonb);
        end if;

          return jsonb_build_object(
              'success', true,
                  'vouchers', coalesce((
                        select jsonb_agg(jsonb_build_object(
                                'id', v.id,
                                        'voucher_number', v.voucher_number,
                                                'student_id', v.student_id,
                                                        'class', v.class,
                                                                'month', v.month,
                                                                        'year', v.year,
                                                                                'fee_period', v.fee_period,
                                                                                        'fee_items', v.fee_items,
                                                                                                'total_amount', v.total_amount,
                                                                                                        'due_date', v.due_date,
                                                                                                                'bank_details', v.bank_details,
                                                                                                                        'status', v.status,
                                                                                                                                'late_fee', v.late_fee,
                                                                                                                                        'paid_amount', v.paid_amount,
                                                                                                                                                'notes', v.notes,
                                                                                                                                                        'created_at', v.created_at,
                                                                                                                                                                'updated_at', v.updated_at,
                                                                                                                                                                        'students', jsonb_build_object(
                                                                                                                                                                                  'full_name', s.full_name,
                                                                                                                                                                                            'roll_number', s.roll_number,
                                                                                                                                                                                                      'father_name', s.father_name,
                                                                                                                                                                                                                'contact_number', s.contact_number,
                                                                                                                                                                                                                          'photo_url', s.photo_url
                                                                                                                                                                                                                                  )
                                                                                                                                                                                                                                        ) order by v.year desc, v.month desc, v.created_at desc)
                                                                                                                                                                                                                                              from public.fee_vouchers v
                                                                                                                                                                                                                                                    left join public.students s on s.id = v.student_id
                                                                                                                                                                                                                                                        ), '[]'::jsonb)
                                                                                                                                                                                                                                                          );
                                                                                                                                                                                                                                                          end;
                                                                                                                                                                                                                                                          $$;





CREATE FUNCTION public.get_applicant_admission(p_admission_id uuid, p_phone text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_phone     text := public.normalize_phone(p_phone);
  v_admission record;
  v_timeline  jsonb;
begin
  if v_phone = '' or p_admission_id is null then
    return jsonb_build_object('success', false, 'error', 'Missing parameters.');
  end if;

  -- Fetch admission ONLY if the phone matches (security check —
  -- prevents someone from guessing a UUID and reading another person's data)
  select * into v_admission
    from public.admissions
   where id = p_admission_id
     and (
       public.normalize_phone(contact_number)  = v_phone
       or public.normalize_phone(whatsapp_number) = v_phone
     )
   limit 1;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Application not found for this phone number.'
    );
  end if;

  -- Fetch timeline (defensive: if table missing, return empty array)
  begin
    select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb) into v_timeline
      from public.admission_status_timeline t
     where t.admission_id = p_admission_id;
  exception when others then
    v_timeline := '[]'::jsonb;
  end;

  return jsonb_build_object(
    'success',   true,
    'admission', to_jsonb(v_admission),
    'timeline',  v_timeline
  );
end;
$$;





CREATE FUNCTION public.get_my_poll_vote(p_notice_id uuid, p_voter_token text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
                                                                                                                                                                                                    select option_id from public.poll_votes
                                                                                                                                                                                                      where notice_id = p_notice_id and voter_token = p_voter_token
                                                                                                                                                                                                        limit 1;
                                                                                                                                                                                                        $$;





CREATE FUNCTION public.get_my_profile() RETURNS json
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT row_to_json(p)
    FROM profiles p
      WHERE p.id = auth.uid()
        LIMIT 1;
        $$;





CREATE FUNCTION public.handle_new_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
                                                                                     DECLARE
                                                                                       v_full_name text;
                                                                                         v_avatar_url text;
                                                                                         BEGIN
                                                                                           -- Google OAuth puts the display name under different keys depending on
                                                                                             -- provider response shape — check the common ones in priority order.
                                                                                               v_full_name := COALESCE(
                                                                                                   NEW.raw_user_meta_data ->> 'full_name',
                                                                                                       NEW.raw_user_meta_data ->> 'name',
                                                                                                           split_part(NEW.email, '@', 1)
                                                                                                             );

                                                                                                               v_avatar_url := NEW.raw_user_meta_data ->> 'avatar_url';

                                                                                                                 INSERT INTO profiles (id, full_name, role, phone, status, avatar_url)
                                                                                                                   VALUES (
                                                                                                                       NEW.id,
                                                                                                                           v_full_name,
                                                                                                                               COALESCE(NEW.raw_user_meta_data ->> 'role', 'student'),
                                                                                                                                   NEW.raw_user_meta_data ->> 'phone',
                                                                                                                                       'pending',
                                                                                                                                           v_avatar_url
                                                                                                                                             )
                                                                                                                                               ON CONFLICT (id) DO NOTHING;

                                                                                                                                                 RETURN NEW;
                                                                                                                                                 END;
                                                                                                                                                 $$;





CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, class, roll_number, phone, status)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'full_name',
    COALESCE(new.raw_user_meta_data->>'role', 'user'),
    new.raw_user_meta_data->>'class',
    new.raw_user_meta_data->>'roll_number',
    new.raw_user_meta_data->>'phone',
    COALESCE(new.raw_user_meta_data->>'status', 'pending')
  );
  RETURN new;
END;
$$;





CREATE FUNCTION public.handle_new_user_profile() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (
      id,
          full_name,
              role,
                  class,
                      roll_number,
                          phone,
                              status
                                )
                                  VALUES (
                                      NEW.id,
                                          COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
                                              COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
                                                  NEW.raw_user_meta_data->>'class',
                                                      NEW.raw_user_meta_data->>'roll_number',
                                                          NEW.raw_user_meta_data->>'phone',
                                                              COALESCE(NEW.raw_user_meta_data->>'status', 'pending')
                                                                )
                                                                  ON CONFLICT (id) DO NOTHING; -- safe: won't overwrite if already exists
                                                                    RETURN NEW;
                                                                    END;
                                                                    $$;





CREATE FUNCTION public.increment_download_count(file_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.library_files
  SET download_count = download_count + 1
  WHERE id = file_id;
END;
$$;





CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    AS $$
                                                                              SELECT EXISTS (
                                                                                  SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
                                                                                    );
                                                                                    $$;





CREATE FUNCTION public.mark_overdue_vouchers() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                                                                                                                                                                                                                                                                                                                                                            BEGIN
                                                                                                                                                                                                                                                                                                                                                                                                                                              UPDATE fee_vouchers
                                                                                                                                                                                                                                                                                                                                                                                                                                                SET status = 'overdue'
                                                                                                                                                                                                                                                                                                                                                                                                                                                  WHERE status = 'unpaid'
                                                                                                                                                                                                                                                                                                                                                                                                                                                      AND due_date < CURRENT_DATE;
                                                                                                                                                                                                                                                                                                                                                                                                                                                      END;
                                                                                                                                                                                                                                                                                                                                                                                                                                                      $$;





CREATE FUNCTION public.normalize_phone(p_phone text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
$$;





CREATE FUNCTION public.notify_admin_contact(p_name text, p_email text, p_subject text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
      DECLARE
        v_admin_email text;
          v_mailto      text;
          BEGIN
            -- Basic guard so this can't be spammed with empty junk.
              IF coalesce(trim(p_name), '') = '' THEN
                  RETURN;
                    END IF;

                      SELECT email INTO v_admin_email FROM school_settings ORDER BY id LIMIT 1;
                        v_admin_email := coalesce(v_admin_email, 'your-email@example.com');

                          -- mailto: link, pre-filled with a subject so it's obvious which message
                            -- this is about when the mail app opens.
                              v_mailto := 'mailto:' || v_admin_email
                                  || '?subject=' || coalesce(trim(p_subject), 'Message from ' || trim(p_name));

                                    PERFORM fn_notify(
                                        'admin',
                                            'contact_message',
                                                LEFT(trim(p_name), 80) || ' sent you a message — check it out',
                                                    CASE WHEN coalesce(trim(p_subject), '') <> ''
                                                             THEN 'Subject: ' || LEFT(trim(p_subject), 120)
                                                                      ELSE NULL
                                                                          END,
                                                                              v_mailto,
                                                                                  NULL
                                                                                    );
                                                                                    END;
                                                                                    $$;





CREATE FUNCTION public.notify_applicant_sms(p_phone text, p_message text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_phone text := public.normalize_phone(p_phone);
begin
  if v_phone is null or v_phone = '' then
    return;
  end if;

  -- Always log to outbox so admins can audit outgoing messages.
  insert into public.sms_outbox (to_phone, message, status)
  values (v_phone, left(p_message, 480), 'queued');

  -- ──────────────────────────────────────────────────────────────────────
  -- TODO (production): replace the above insert with a real SMS dispatch.
  -- Example using pg_net (Supabase comes with pg_net preinstalled):
  --
  --   select net.http_post(
  --     url := 'https://your-sms-gateway.com/api/send',
  --     headers := jsonb_build_object(
  --       'Content-Type', 'application/json',
  --       'Authorization', 'Bearer ' || current_setting('app.sms_api_key', true)
  --     ),
  --     body := jsonb_build_object(
  --       'to',      v_phone,
  --       'message', left(p_message, 480)
  --     )
  --   );
  --
  -- Or call a Supabase Edge Function via `net.http_post` to keep the
  -- gateway credentials out of the database.
  -- ──────────────────────────────────────────────────────────────────────
end;
$$;





CREATE FUNCTION public.request_admission_otp(p_contact_number text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_code      text;
  v_count_1h  integer;
  v_admission record;
begin
  -- Normalize phone: strip everything but digits and leading +
  p_contact_number := regexp_replace(p_contact_number, '[^0-9+]', '', 'g');

  -- Rate limit: max 10 OTP requests per phone per hour
  select count(*) into v_count_1h
    from public.admission_otp_codes
   where contact_number = p_contact_number
     and created_at > now() - interval '1 hour';
  if v_count_1h >= 10 then
    return jsonb_build_object('success', false, 'error', 'Too many OTP requests. Please wait an hour and try again.');
  end if;

  -- Verify phone matches an admission on file
  select id, full_name, reference_no into v_admission
    from public.admissions
   where contact_number = p_contact_number
      or whatsapp_number = p_contact_number
   order by created_at desc
   limit 1;

  if not found then
    -- Don't reveal whether phone exists — return generic success
    return jsonb_build_object('success', true, 'demo_code', null, 'note', 'If this phone matches an application, an OTP has been sent.');
  end if;

  -- Generate 6-digit code
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  insert into public.admission_otp_codes (contact_number, otp_code, expires_at)
  values (p_contact_number, v_code, now() + interval '10 minutes');

  -- In production: send v_code via SMS gateway here.
  -- For demo: return it so the UI can display it (dev/test only).
  return jsonb_build_object(
    'success', true,
    'demo_code', v_code,  -- REMOVE in production after SMS gateway integration
    'name_hint', left(v_admission.full_name, 1) || '***' || right(v_admission.full_name, 1)
  );
end;
$$;





CREATE FUNCTION public.save_admission_docs(p_b_form_no text, p_docs text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
                                                                                                                      declare
                                                                                                                        v_id  uuid;
                                                                                                                          v_doc json;
                                                                                                                          begin
                                                                                                                            select id into v_id from public.admissions
                                                                                                                               where b_form_no = p_b_form_no order by created_at desc limit 1;
                                                                                                                                 if v_id is null then return; end if;
                                                                                                                                   for v_doc in select * from json_array_elements(p_docs::json) loop
                                                                                                                                       insert into public.admission_documents(admission_id, doc_type, file_path, file_name)
                                                                                                                                           values (v_id, v_doc->>'doc_type', v_doc->>'file_path', v_doc->>'file_name');
                                                                                                                                             end loop;
                                                                                                                                             end;
                                                                                                                                             $$;





CREATE FUNCTION public.set_lab_content_cache_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
                    begin
                      new.updated_at = now();
                        return new;
                        end;
                        $$;





CREATE FUNCTION public.set_merit_lists_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
                                                                                                                                                                                                            BEGIN
                                                                                                                                                                                                              NEW.updated_at = now();
                                                                                                                                                                                                                RETURN NEW;
                                                                                                                                                                                                                END;
                                                                                                                                                                                                                $$;





CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
                              BEGIN
                                NEW.updated_at = now();
                                  RETURN NEW;
                                  END;
                                  $$;





CREATE FUNCTION public.submit_admission_public(full_name text, father_name text, date_of_birth date, b_form_no text, contact_number text, whatsapp_number text DEFAULT NULL::text, home_address text DEFAULT NULL::text, gender text DEFAULT NULL::text, applying_class text DEFAULT NULL::text, admission_type public.admission_type DEFAULT 'fresh'::public.admission_type, previous_school text DEFAULT NULL::text, previous_class text DEFAULT NULL::text, previous_marks text DEFAULT NULL::text, year_of_passing text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
                            declare
                              new_id uuid;
                                new_ref text;
                                begin
                                  insert into public.admissions (
                                      full_name, father_name, date_of_birth, b_form_no,
                                          contact_number, whatsapp_number, home_address, gender,
                                              applying_class, admission_type, previous_school,
                                                  previous_class, previous_marks, year_of_passing,
                                                      reference_no
                                                        ) values (
                                                            full_name, father_name, date_of_birth, b_form_no,
                                                                contact_number, whatsapp_number, home_address, gender,
                                                                    applying_class, admission_type, previous_school,
                                                                        previous_class, previous_marks, year_of_passing,
                                                                            ''
                                                                              )
                                                                                returning id, reference_no into new_id, new_ref;

                                                                                  return json_build_object('id', new_id, 'reference_no', new_ref);
                                                                                  end;
                                                                                  $$;





CREATE FUNCTION public.submit_admission_public(p_full_name text, p_father_name text, p_date_of_birth text DEFAULT NULL::text, p_b_form_no text DEFAULT NULL::text, p_contact_number text DEFAULT NULL::text, p_whatsapp_number text DEFAULT NULL::text, p_home_address text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_applying_class text DEFAULT NULL::text, p_admission_type text DEFAULT 'fresh'::text, p_previous_school text DEFAULT NULL::text, p_previous_class text DEFAULT NULL::text, p_previous_marks text DEFAULT NULL::text, p_year_of_passing text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE new_id uuid; new_ref text; BEGIN INSERT INTO public.admissions(reference_no, full_name, father_name, b_form_no, contact_number, whatsapp_number, home_address, gender, applying_class, admission_type, previous_school, previous_class, previous_marks, year_of_passing) VALUES ('', p_full_name, p_father_name, p_b_form_no, p_contact_number, p_whatsapp_number, p_home_address, p_gender, p_applying_class, p_admission_type::public.admission_type, p_previous_school, p_previous_class, p_previous_marks, p_year_of_passing) RETURNING id, reference_no INTO new_id, new_ref; RETURN json_build_object('id', new_id, 'reference_no', new_ref); END; $$;





CREATE FUNCTION public.submit_admission_with_docs(p_full_name text, p_father_name text, p_date_of_birth date, p_b_form_no text, p_contact_number text, p_whatsapp_number text, p_home_address text, p_gender text, p_applying_class text, p_admission_type text, p_previous_school text, p_previous_class text, p_previous_marks text, p_year_of_passing text, p_docs text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
                              declare
                                v_id           uuid;
                                  v_reference_no text;
                                    v_doc          json;
                                      v_docs_arr     json;
                                      begin
                                        -- Insert admission — trigger will set reference_no automatically
                                          insert into public.admissions (
                                              full_name, father_name, date_of_birth, b_form_no,
                                                  contact_number, whatsapp_number, home_address, gender,
                                                      applying_class, admission_type,
                                                          previous_school, previous_class, previous_marks, year_of_passing,
                                                              reference_no
                                                                ) values (
                                                                    p_full_name, p_father_name, p_date_of_birth, p_b_form_no,
                                                                        p_contact_number, p_whatsapp_number, p_home_address, p_gender,
                                                                            p_applying_class, p_admission_type::public.admission_type,
                                                                                p_previous_school, p_previous_class, p_previous_marks, p_year_of_passing,
                                                                                    ''  -- trigger overwrites this with OHS-YYYY-XXXX
                                                                                      )
                                                                                        returning id, reference_no into v_id, v_reference_no;

                                                                                          -- Insert documents if any were provided
                                                                                            if p_docs is not null and p_docs <> '' and p_docs <> '[]' then
                                                                                                v_docs_arr := p_docs::json;
                                                                                                    for v_doc in select * from json_array_elements(v_docs_arr)
                                                                                                        loop
                                                                                                              insert into public.admission_documents (
                                                                                                                      admission_id, doc_type, file_path, file_name
                                                                                                                            ) values (
                                                                                                                                    v_id,
                                                                                                                                            v_doc->>'doc_type',
                                                                                                                                                    v_doc->>'file_path',
                                                                                                                                                            v_doc->>'file_name'
                                                                                                                                                                  );
                                                                                                                                                                      end loop;
                                                                                                                                                                        end if;

                                                                                                                                                                          return json_build_object('id', v_id, 'reference_no', v_reference_no);
                                                                                                                                                                          end;
                                                                                                                                                                          $$;





CREATE FUNCTION public.touch_admissions_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
                                                                                                      begin new.updated_at := now(); return new; end;
                                                                                                      $$;





CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
                                                                                      begin
                                                                                        new.updated_at = now();
                                                                                          return new;
                                                                                          end; $$;





CREATE FUNCTION public.track_admission(p_query text) RETURNS SETOF public.admissions
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
                                SELECT a.*
                                  FROM public.admissions a
                                    WHERE lower(a.reference_no)      = lower(p_query)
                                         OR lower(a.b_form_no)         = lower(p_query)
                                              OR lower(a.contact_number)    = lower(p_query)
                                                   OR lower(a.whatsapp_number)   = lower(p_query)
                                                        OR lower(a.admission_roll_no) = lower(p_query)
                                                          ORDER BY a.created_at DESC
                                                            LIMIT 5;
                                                            $$;





CREATE FUNCTION public.trg_fn_achievement_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                                                                                                                                          BEGIN
                                                                                                                                                                                                                            PERFORM fn_notify(
                                                                                                                                                                                                                                'all', 'achievement',
                                                                                                                                                                                                                                    'New Achievement: ' || COALESCE(NEW.title, ''),
                                                                                                                                                                                                                                        LEFT(COALESCE(NEW.description, ''), 160),
                                                                                                                                                                                                                                            '/dashboard?tab=achievements'
                                                                                                                                                                                                                                              );
                                                                                                                                                                                                                                                RETURN NEW;
                                                                                                                                                                                                                                                END;
                                                                                                                                                                                                                                                $$;





CREATE FUNCTION public.trg_fn_admission_application_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                                                                                                                                                                                      BEGIN
                                                                                                                                                                                                                                                                        PERFORM fn_notify(
                                                                                                                                                                                                                                                                            'admin', 'admission_application',
                                                                                                                                                                                                                                                                                'New Admission Application: ' || COALESCE(NEW.full_name, 'Applicant'),
                                                                                                                                                                                                                                                                                    'Reference: ' || COALESCE(NEW.reference_no, '?') || ' • Class ' || COALESCE(NEW.applying_class, '?') || ' • ' || COALESCE(NEW.father_name, ''),
                                                                                                                                                                                                                                                                                        '/admin?tab=admissions'
                                                                                                                                                                                                                                                                                          );
                                                                                                                                                                                                                                                                                            RETURN NEW;
                                                                                                                                                                                                                                                                                            END;
                                                                                                                                                                                                                                                                                            $$;





CREATE FUNCTION public.trg_fn_admission_doc_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                                                                                                                                                                                                            BEGIN
                                                                                                                                                                                                                                                                                              PERFORM fn_notify(
                                                                                                                                                                                                                                                                                                  'admin', 'admission_doc',
                                                                                                                                                                                                                                                                                                      'New Document Uploaded',
                                                                                                                                                                                                                                                                                                          'A document was uploaded for admission: ' || COALESCE(NEW.doc_type, 'document'),
                                                                                                                                                                                                                                                                                                              '/admin?tab=admissions'
                                                                                                                                                                                                                                                                                                                );
                                                                                                                                                                                                                                                                                                                  RETURN NEW;
                                                                                                                                                                                                                                                                                                                  END;
                                                                                                                                                                                                                                                                                                                  $$;





CREATE FUNCTION public.trg_fn_admission_open_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.is_open = true AND (OLD IS NULL OR OLD.is_open = false) THEN
    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE type = 'admission_open'
        AND created_at > now() - interval '5 minutes'
    ) THEN
      PERFORM fn_notify(
        'all', 'admission_open',
        'Admissions Are Now Open!',
        COALESCE(NEW.banner_message, 'Applications are being accepted for ' || COALESCE(NEW.session_year, 'the new session') || '.'),
        '/admission'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;





CREATE FUNCTION public.trg_fn_chapter_question_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                        DECLARE
                                                                                          v_link  text;
                                                                                            v_title text;
                                                                                              v_name  text;
                                                                                              BEGIN
                                                                                                SELECT '/notes/' || s.slug || '/' || c.slug, c.title
                                                                                                    INTO v_link, v_title
                                                                                                      FROM note_chapters c
                                                                                                        JOIN note_subjects s ON s.id = c.subject_id
                                                                                                          WHERE c.id = NEW.chapter_id;

                                                                                                            SELECT full_name INTO v_name FROM profiles WHERE id = NEW.user_id;

                                                                                                              PERFORM fn_notify(
                                                                                                                  'admin', 'chapter_question',
                                                                                                                      COALESCE(v_name, 'A student') || ' asked a question — check it out',
                                                                                                                          'On: ' || COALESCE(v_title, 'a chapter') || ' — ' || LEFT(NEW.question, 120),
                                                                                                                              COALESCE(v_link, '/admin?tab=notes'),
                                                                                                                                  NEW.user_id
                                                                                                                                    );
                                                                                                                                      RETURN NEW;
                                                                                                                                      END;
                                                                                                                                      $$;





CREATE FUNCTION public.trg_fn_contact_message_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                  BEGIN
                                                                    PERFORM fn_notify(
                                                                        'admin', 'contact_message',
                                                                            'New Contact Message: ' || COALESCE(NEW.subject, 'No subject'),
                                                                                COALESCE(NEW.name, 'Someone') || ' (' || COALESCE(NEW.email, '') || ') — ' || LEFT(COALESCE(NEW.message, ''), 140),
                                                                                    '/admin?tab=messages',
                                                                                        NEW.user_id
                                                                                          );
                                                                                            RETURN NEW;
                                                                                            END;
                                                                                            $$;





CREATE FUNCTION public.trg_fn_event_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.is_published THEN
    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE type = 'event'
        AND title = 'New Event: ' || COALESCE(NEW.title, 'School Event')
        AND created_at > now() - interval '60 seconds'
    ) THEN
      PERFORM fn_notify(
        'all', 'event',
        'New Event: ' || COALESCE(NEW.title, 'School Event'),
        COALESCE(NEW.description, LEFT(COALESCE(NEW.start_date::text, ''), 50)),
        '/calendar'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;





CREATE FUNCTION public.trg_fn_exam_roll_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.is_published = true AND (OLD IS NULL OR OLD.is_published = false) THEN
      PERFORM fn_notify(
            'all', 'exam_roll',
                  'Exam Roll Numbers Published',
                        COALESCE(NEW.title, 'Exam session') || ' — roll numbers are now available.',
                              '/dashboard?tab=exam-rolls'
                                  );
                                    END IF;
                                      RETURN NEW;
                                      END;
                                      $$;





CREATE FUNCTION public.trg_fn_exam_seating_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_was_published boolean;
    v_is_published_now boolean;
      v_is_scheduled_now boolean;
        v_room_count int;
          v_body text;
            v_title text;
            BEGIN
              v_was_published    := (OLD IS NOT NULL AND OLD.status = 'published');
                v_is_published_now := (NEW.status = 'published');
                  v_is_scheduled_now := (NEW.publish_at IS NOT NULL AND NEW.status <> 'published');

                    SELECT count(*) INTO v_room_count FROM exam_seating_rooms WHERE plan_id = NEW.id;

                      -- ─── Case A: Publish-now ──────────────────────────────────────────────
                        IF v_is_published_now AND NOT v_was_published THEN
                            v_title := 'Exam Seating Published: ' || COALESCE(NEW.title, 'Seating Plan');
                                v_body  := COALESCE(NEW.title, 'Seating plan') || ' is now visible.' ||
                                               CASE WHEN array_length(NEW.classes, 1) IS NOT NULL
                                                                   THEN ' Classes: ' || array_to_string(NEW.classes, ', ') || '.'
                                                                                       ELSE '' END ||
                                                                                                      CASE WHEN NEW.paper_subject IS NOT NULL
                                                                                                                          THEN ' Paper: ' || NEW.paper_subject || '.'
                                                                                                                                              ELSE '' END ||
                                                                                                                                                             CASE WHEN NEW.exam_date IS NOT NULL
                                                                                                                                                                                 THEN ' Date: ' || NEW.exam_date::text || '.'
                                                                                                                                                                                                     ELSE '' END ||
                                                                                                                                                                                                                    CASE WHEN v_room_count > 0
                                                                                                                                                                                                                                        THEN ' Rooms: ' || v_room_count || '.'
                                                                                                                                                                                                                                                            ELSE '' END ||
                                                                                                                                                                                                                                                                           CASE WHEN NEW.total_seated > 0
                                                                                                                                                                                                                                                                                               THEN ' Seated: ' || NEW.total_seated || ' students.'
                                                                                                                                                                                                                                                                                                                   ELSE '' END;

                                                                                                                                                                                                                                                                                                                       -- audience='students' → visible to all NON-admin users (per migration 013 RLS)
                                                                                                                                                                                                                                                                                                                           PERFORM fn_notify(
                                                                                                                                                                                                                                                                                                                                 'students',
                                                                                                                                                                                                                                                                                                                                       'exam_seating',
                                                                                                                                                                                                                                                                                                                                             v_title,
                                                                                                                                                                                                                                                                                                                                                   v_body,
                                                                                                                                                                                                                                                                                                                                                         '/dashboard?tab=seating',
                                                                                                                                                                                                                                                                                                                                                               NEW.created_by
                                                                                                                                                                                                                                                                                                                                                                   );
                                                                                                                                                                                                                                                                                                                                                                       RETURN NEW;
                                                                                                                                                                                                                                                                                                                                                                         END IF;

                                                                                                                                                                                                                                                                                                                                                                           -- ─── Case B: Schedule-with-countdown ─────────────────────────────────
                                                                                                                                                                                                                                                                                                                                                                             IF v_is_scheduled_now AND (OLD IS NULL OR OLD.publish_at IS DISTINCT FROM NEW.publish_at) THEN
                                                                                                                                                                                                                                                                                                                                                                                 v_title := 'Exam Seating Scheduled: ' || COALESCE(NEW.title, 'Seating Plan');
                                                                                                                                                                                                                                                                                                                                                                                     v_body  := COALESCE(NEW.countdown_label, 'Seats will be revealed') ||
                                                                                                                                                                                                                                                                                                                                                                                                    ' at ' || to_char(NEW.publish_at AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD HH24:MI') ||
                                                                                                                                                                                                                                                                                                                                                                                                                   ' (PKT).' ||
                                                                                                                                                                                                                                                                                                                                                                                                                                  CASE WHEN array_length(NEW.classes, 1) IS NOT NULL
                                                                                                                                                                                                                                                                                                                                                                                                                                                      THEN ' Classes: ' || array_to_string(NEW.classes, ', ') || '.'
                                                                                                                                                                                                                                                                                                                                                                                                                                                                          ELSE '' END ||
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         CASE WHEN v_room_count > 0
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             THEN ' Rooms: ' || v_room_count || '.'
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 ELSE '' END;

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     PERFORM fn_notify(
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           'students',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 'exam_seating',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       v_title,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             v_body,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   '/dashboard?tab=seating',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         NEW.created_by
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             );
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 RETURN NEW;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   END IF;

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     RETURN NEW;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     END;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     $$;





CREATE FUNCTION public.trg_fn_fee_voucher_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                      BEGIN
                                        PERFORM fn_notify(
                                            'user:' || NEW.student_id::text, 'fee',
                                                'New Fee Voucher: ' || COALESCE(NEW.voucher_number, ''),
                                                    'Rs ' || COALESCE(NEW.total_amount::text, '0') || ' due ' || COALESCE(NEW.due_date::text, '') || '. Status: ' || NEW.status,
                                                        '/dashboard?tab=fees'
                                                          );
                                                            RETURN NEW;
                                                            END;
                                                            $$;





CREATE FUNCTION public.trg_fn_gallery_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      DECLARE
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        v_title text; v_caption text;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        BEGIN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          v_title   := to_jsonb(NEW) ->> 'title';
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            v_caption := to_jsonb(NEW) ->> 'caption';
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              IF v_title IS NULL THEN v_title := to_jsonb(NEW) ->> 'caption'; END IF;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                IF v_title IS NULL THEN v_title := to_jsonb(NEW) ->> 'description'; END IF;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  PERFORM fn_notify('all', 'gallery',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      'New Photo in Gallery',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          COALESCE(v_title, 'A new photo was uploaded.'),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              '/gallery');
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                RETURN NEW;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                EXCEPTION WHEN OTHERS THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  RAISE NOTICE 'gallery notify skipped: %', SQLERRM;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    RETURN NEW;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    END;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    $$;





CREATE FUNCTION public.trg_fn_homework_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                                                                                                                                                                BEGIN
                                                                                                                                                                                                                                                  PERFORM fn_notify(
                                                                                                                                                                                                                                                      'class:' || COALESCE(NEW.class, ''), 'homework',
                                                                                                                                                                                                                                                          'New Homework: ' || COALESCE(NEW.title, 'Homework'),
                                                                                                                                                                                                                                                              COALESCE(NEW.subject, ''),
                                                                                                                                                                                                                                                                  '/dashboard?tab=notes'
                                                                                                                                                                                                                                                                    );
                                                                                                                                                                                                                                                                      RETURN NEW;
                                                                                                                                                                                                                                                                      END;
                                                                                                                                                                                                                                                                      $$;





CREATE FUNCTION public.trg_fn_id_card_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                            BEGIN
                                                              IF NEW.student_id IS NOT NULL THEN
                                                                  PERFORM fn_notify(
                                                                        'user:' || NEW.student_id::text, 'id_card',
                                                                              'Student ID Card Generated',
                                                                                    'Your ID card is ready. View it in your dashboard.',
                                                                                          '/dashboard?tab=id-cards'
                                                                                              );
                                                                                                END IF;
                                                                                                  RETURN NEW;
                                                                                                  END;
                                                                                                  $$;





CREATE FUNCTION public.trg_fn_library_book_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM notifications
    WHERE type = 'library'
      AND created_at > now() - interval '60 seconds'
  ) THEN
    PERFORM fn_notify(
      'all', 'library',
      'New Books Added to Library',
      'Check the library page for the latest additions.',
      '/library'
    );
  END IF;
  RETURN NEW;
END;
$$;





CREATE FUNCTION public.trg_fn_mistake_report_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                  DECLARE
                                                    v_link  text;
                                                      v_title text;
                                                        v_name  text;
                                                        BEGIN
                                                          SELECT '/notes/' || s.slug || '/' || c.slug, c.title
                                                              INTO v_link, v_title
                                                                FROM note_chapters c
                                                                  JOIN note_subjects s ON s.id = c.subject_id
                                                                    WHERE c.id = NEW.chapter_id;

                                                                      SELECT full_name INTO v_name FROM profiles WHERE id = NEW.user_id;

                                                                        PERFORM fn_notify(
                                                                            'admin', 'mistake_report',
                                                                                COALESCE(v_name, 'A student') || ' reported a mistake — check it out',
                                                                                    'On: ' || COALESCE(v_title, 'a chapter') || ' — ' || LEFT(NEW.report, 120),
                                                                                        COALESCE(v_link, '/admin?tab=notes'),
                                                                                            NEW.user_id
                                                                                              );
                                                                                                RETURN NEW;
                                                                                                END;
                                                                                                $$;





CREATE FUNCTION public.trg_fn_news_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.is_published THEN
    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE type = 'news'
        AND title = COALESCE(NEW.title, 'New News Article')
        AND created_at > now() - interval '60 seconds'
    ) THEN
      PERFORM fn_notify(
        'all', 'news',
        COALESCE(NEW.title, 'New News Article'),
        LEFT(COALESCE(NEW.content, ''), 200),
        '/news/' || NEW.id::text
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;





CREATE FUNCTION public.trg_fn_notes_chapter_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                DECLARE
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  v_title text; v_subject text; v_class text;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  BEGIN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    v_title   := COALESCE(to_jsonb(NEW) ->> 'title', to_jsonb(NEW) ->> 'name');
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      v_subject := to_jsonb(NEW) ->> 'subject';
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        v_class   := COALESCE(to_jsonb(NEW) ->> 'class', to_jsonb(NEW) ->> 'class_name');
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          IF v_class IS NOT NULL THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              PERFORM fn_notify('class:' || v_class, 'notes_chapter',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    'New Chapter Added: ' || COALESCE(v_title, ''),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          COALESCE(v_subject, ''),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                '/dashboard');
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  ELSE
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      PERFORM fn_notify('all', 'notes_chapter',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            'New Chapter Added: ' || COALESCE(v_title, ''),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  COALESCE(v_subject, ''),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        '/dashboard');
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          END IF;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            RETURN NEW;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            EXCEPTION WHEN OTHERS THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              RAISE NOTICE 'notes_chapter notify skipped: %', SQLERRM;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                RETURN NEW;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                END;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                $$;





CREATE FUNCTION public.trg_fn_notes_feedback_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    DECLARE
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      v_user text; v_text text; v_chapter text;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      BEGIN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        v_user    := COALESCE(to_jsonb(NEW) ->> 'user_id', to_jsonb(NEW) ->> 'author_id');
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          v_text    := COALESCE(to_jsonb(NEW) ->> 'content', to_jsonb(NEW) ->> 'text', to_jsonb(NEW) ->> 'body');
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            v_chapter := COALESCE(to_jsonb(NEW) ->> 'chapter_id', to_jsonb(NEW) ->> 'note_id');
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              PERFORM fn_notify('admin', 'notes_feedback',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  'New Feedback in Notes Manager',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      LEFT(COALESCE(v_text, 'A user posted feedback.'), 160),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          '/admin?tab=notes');
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            RETURN NEW;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            EXCEPTION WHEN OTHERS THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              RAISE NOTICE 'notes_feedback notify skipped: %', SQLERRM;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                RETURN NEW;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                END;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                $$;





CREATE FUNCTION public.trg_fn_notice_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.is_published THEN
      PERFORM fn_notify(
            'all', 'notice',
                  COALESCE(NEW.title, 'New Notice'),
                        LEFT(COALESCE(NEW.content, ''), 200),
                              '/notices/' || NEW.id::text,
                                    NULL
                                        );
                                          END IF;
                                            RETURN NEW;
                                            END;
                                            $$;





CREATE FUNCTION public.trg_fn_online_class_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                                                                                                                    BEGIN
                                                                                                                                                                                                      PERFORM fn_notify(
                                                                                                                                                                                                          'class:' || COALESCE(NEW.class_name, ''), 'online_class',
                                                                                                                                                                                                              'Online Class Scheduled: ' || COALESCE(NEW.title, ''),
                                                                                                                                                                                                                  COALESCE(NEW.subject, '') || ' — ' || COALESCE(NEW.start_time::text, ''),
                                                                                                                                                                                                                      '/dashboard?tab=online-classes'
                                                                                                                                                                                                                        );
                                                                                                                                                                                                                          RETURN NEW;
                                                                                                                                                                                                                          END;
                                                                                                                                                                                                                          $$;





CREATE FUNCTION public.trg_fn_result_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_title text;
BEGIN
  -- Only fire when is_published transitions to TRUE
  IF NEW.is_published = true AND (OLD IS NULL OR OLD.is_published = false OR OLD.is_published IS NULL) THEN
    v_title := 'Results Published: ' || COALESCE(NEW.exam_type, 'Exam') || ' ' || COALESCE(NEW.year::text, '') || ' — Class ' || COALESCE(NEW.class, '?');

    -- Suppress if a notification with the same title was created in the
    -- last 5 minutes. This means: for any single publish event (whether
    -- admin publishes 1 row, 30 rows in one transaction, or 30 rows in 30
    -- separate UPDATE queries fired by clicking "Publish All"), only the
    -- FIRST row that flips is_published → true gets a notification.
    -- Subsequent rows in the same publish batch are suppressed.
    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE type = 'result'
        AND title = v_title
        AND created_at > now() - interval '5 minutes'
    ) THEN
      PERFORM fn_notify(
        'all', 'result',
        v_title,
        'Class ' || COALESCE(NEW.class, '?') || ' results are now available.',
        '/results'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;





CREATE FUNCTION public.trg_fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
                                                                                                                                                                                              BEGIN
                                                                                                                                                                                                NEW.updated_at = now();
                                                                                                                                                                                                  RETURN NEW;
                                                                                                                                                                                                  END;
                                                                                                                                                                                                  $$;





CREATE FUNCTION public.trg_fn_timetable_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                                                                                                                                                                                                                                                                                                                                                                      DECLARE
                                                                                                                                                                                                                                                                                                                                                                                                                                                        v_class text;
                                                                                                                                                                                                                                                                                                                                                                                                                                                        BEGIN
                                                                                                                                                                                                                                                                                                                                                                                                                                                          v_class := to_jsonb(NEW) ->> 'class';
                                                                                                                                                                                                                                                                                                                                                                                                                                                            IF v_class IS NOT NULL AND NOT EXISTS (
                                                                                                                                                                                                                                                                                                                                                                                                                                                                SELECT 1 FROM notifications
                                                                                                                                                                                                                                                                                                                                                                                                                                                                    WHERE type = 'timetable'
                                                                                                                                                                                                                                                                                                                                                                                                                                                                          AND audience = 'class:' || v_class
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                AND created_at > now() - interval '60 seconds'
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  ) THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      PERFORM fn_notify('class:' || v_class, 'timetable',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            'Timetable Updated — Class ' || v_class,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  'Your class timetable has been updated.',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        '/dashboard');
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          END IF;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            RETURN NEW;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            EXCEPTION WHEN OTHERS THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              RAISE NOTICE 'timetable notify skipped: %', SQLERRM;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                RETURN NEW;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                END;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                $$;





CREATE FUNCTION public.trg_fn_timetable_notify_dedupe() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                  BEGIN
                                                                                                    IF NOT EXISTS (
                                                                                                        SELECT 1 FROM notifications
                                                                                                            WHERE type = 'timetable'
                                                                                                                  AND audience = 'class:' || COALESCE(NEW.class, '')
                                                                                                                        AND created_at > now() - interval '60 seconds'
                                                                                                                          ) THEN
                                                                                                                              PERFORM fn_notify(
                                                                                                                                    'class:' || COALESCE(NEW.class, ''), 'timetable',
                                                                                                                                          'Timetable Updated — Class ' || COALESCE(NEW.class, ''),
                                                                                                                                                'Your class timetable has been updated.',
                                                                                                                                                      '/dashboard?tab=timetable'
                                                                                                                                                          );
                                                                                                                                                            END IF;
                                                                                                                                                              RETURN NEW;
                                                                                                                                                              END;
                                                                                                                                                              $$;





CREATE FUNCTION public.trg_fn_video_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
                                                                                                                                                              BEGIN
                                                                                                                                                                IF COALESCE(NEW.is_published, true) THEN
                                                                                                                                                                    PERFORM fn_notify(
                                                                                                                                                                          'all', 'video',
                                                                                                                                                                                'New Video: ' || COALESCE(NEW.title, 'Untitled'),
                                                                                                                                                                                      LEFT(COALESCE(NEW.description, ''), 160),
                                                                                                                                                                                            '/dashboard?tab=videos'
                                                                                                                                                                                                );
                                                                                                                                                                                                  END IF;
                                                                                                                                                                                                    RETURN NEW;
                                                                                                                                                                                                    END;
                                                                                                                                                                                                    $$;





CREATE FUNCTION public.update_admission_status(p_admission_id uuid, p_new_status public.admission_status, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
      declare
        v_admission     record;
          v_promoted_id   uuid;
            v_promoted_name text;
            begin
              select * into v_admission from public.admissions where id = p_admission_id for update;
                if not found then
                    return jsonb_build_object('success', false, 'error', 'Application not found.');
                      end if;

                        -- Update status
                          update public.admissions set status = p_new_status where id = p_admission_id;

                            -- Log timeline
                              insert into public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
                                values (p_admission_id, v_admission.status, p_new_status, p_note, 'admin');

                                  -- Waitlist auto-promotion: if status went to 'rejected' or 'cancelled',
                                    -- and the class still has waitlisted applicants, promote the next one.
                                      if p_new_status in ('rejected'::public.admission_status) then
                                          select a.id, a.full_name into v_promoted_id, v_promoted_name
                                                from public.admissions a
                                                     where a.applying_class = v_admission.applying_class
                                                            and a.status = 'waitlisted'::public.admission_status
                                                                 order by a.created_at asc
                                                                      limit 1
                                                                           for update of a;

                                                                               if v_promoted_id is not null then
                                                                                     update public.admissions
                                                                                              set status = 'under_review'::public.admission_status
                                                                                                     where id = v_promoted_id;

                                                                                                           insert into public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
                                                                                                                 values (v_promoted_id, 'waitlisted'::public.admission_status,
                                                                                                                               'under_review'::public.admission_status,
                                                                                                                                             'A seat opened up — you have been promoted from the waitlist.',
                                                                                                                                                           'system');
                                                                                                                                                               end if;
                                                                                                                                                                 end if;

                                                                                                                                                                   return jsonb_build_object('success', true, 'promoted_applicant_id', v_promoted_id::text);
                                                                                                                                                                   end;
                                                                                                                                                                   $$;





CREATE FUNCTION public.update_attendance_daily_stats_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
                                                                                                                                 BEGIN
                                                                                                                                   NEW.updated_at = now();
                                                                                                                                     RETURN NEW;
                                                                                                                                     END;
                                                                                                                                     $$;





CREATE FUNCTION public.update_attendance_thresholds_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
                                                                                                                                                                                                                                       BEGIN
                                                                                                                                                                                                                                         NEW.updated_at = now();
                                                                                                                                                                                                                                           RETURN NEW;
                                                                                                                                                                                                                                           END;
                                                                                                                                                                                                                                           $$;





CREATE FUNCTION public.update_duty_board_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
                                                                              BEGIN
                                                                                NEW.updated_at = now();
                                                                                  RETURN NEW;
                                                                                  END;
                                                                                  $$;





CREATE FUNCTION public.update_school_events_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;





CREATE FUNCTION public.update_timetable_settings_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
              BEGIN
                NEW.updated_at = now();
                  RETURN NEW;
                  END;
                  $$;





CREATE FUNCTION public.update_timetable_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;





CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
                                                                                                                                                                                                                                                                                                                                                                                                                                BEGIN
                                                                                                                                                                                                                                                                                                                                                                                                                                  NEW.updated_at = now();
                                                                                                                                                                                                                                                                                                                                                                                                                                    RETURN NEW;
                                                                                                                                                                                                                                                                                                                                                                                                                                    END;
                                                                                                                                                                                                                                                                                                                                                                                                                                    $$;





CREATE FUNCTION public.verify_admission_otp(p_contact_number text, p_otp_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_phone     text := public.normalize_phone(p_contact_number);
  v_code_in   text := trim(coalesce(p_otp_code, ''));
  v_otp       record;
  v_admission record;
  v_timeline  jsonb := '[]'::jsonb;
  v_table_exists boolean;
begin
  if v_phone = '' or v_code_in = '' then
    return jsonb_build_object('success', false, 'error', 'Phone number and code are required.');
  end if;

  -- Find the most recent unverified, unexpired code for this phone
  select * into v_otp
    from public.admission_otp_codes
   where contact_number = v_phone
     and verified = false
     and expires_at > now()
   order by created_at desc
   limit 1;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'No valid OTP found. Please request a new code.'
    );
  end if;

  if v_otp.attempts >= 5 then
    return jsonb_build_object(
      'success', false,
      'error', 'Too many incorrect attempts. Please request a new code.'
    );
  end if;

  if v_otp.otp_code <> v_code_in then
    update public.admission_otp_codes
       set attempts = attempts + 1
     where id = v_otp.id;
    return jsonb_build_object('success', false, 'error', 'Incorrect code.');
  end if;

  -- Success — mark as verified
  update public.admission_otp_codes
     set verified = true
   where id = v_otp.id;

  -- Fetch admission record (digit-only comparison)
  select to_jsonb(a) into v_admission
    from public.admissions a
   where public.normalize_phone(a.contact_number)  = v_phone
      or public.normalize_phone(a.whatsapp_number) = v_phone
   order by a.created_at desc
   limit 1;

  if not found then
    -- Should not happen because request_admission_otp already verified the
    -- phone exists, but handle it gracefully just in case.
    return jsonb_build_object(
      'success', false,
      'error', 'No application found for this phone number. Please apply first.'
    );
  end if;

  -- ── Defensive timeline fetch ────────────────────────────────────────────
  -- Check if the table exists before querying. If it doesn't, return an
  -- empty timeline so login still succeeds.
  select exists (
    select 1 from information_schema.tables
     where table_schema = 'public'
       and table_name   = 'admission_status_timeline'
  ) into v_table_exists;

  if v_table_exists then
    begin
      select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb) into v_timeline
        from public.admission_status_timeline t
       where t.admission_id = (v_admission->>'id')::uuid;
    exception when others then
      v_timeline := '[]'::jsonb;
    end;
  end if;

  return jsonb_build_object(
    'success',   true,
    'admission', v_admission,
    'timeline',  v_timeline
  );
end;
$$;





CREATE VIEW public.srs_due_today AS
 SELECT sr.id,
    sr.user_id,
    sr.question_id,
    sr.ease_factor,
    sr."interval",
    sr.repetitions,
    sr.next_review_date,
    sr.last_reviewed_at,
    sr.created_at,
    nq.question,
    nq.correct,
    nq.difficulty,
    p.full_name AS student_name
   FROM ((public.srs_reviews sr
     JOIN public.note_questions nq ON ((nq.id = sr.question_id)))
     JOIN public.profiles p ON ((p.id = sr.user_id)))
  WHERE (sr.next_review_date <= CURRENT_DATE);





CREATE VIEW public.v_student_seating AS
 SELECT a.student_id,
    a.class,
    a.class_roll_no,
    a.exam_roll_no,
    a.student_name,
    a.plan_id,
    p.title AS plan_title,
    p.session_id,
    p.paper_subject,
    p.exam_date,
    p.status AS plan_status,
    a.room_id,
    r.name AS room_name,
    r.invigilator,
    r.notes AS room_notes,
    a.row_idx,
    a.col_idx,
    a.seat_label,
    a.qr_token
   FROM ((public.exam_seating_assignments a
     JOIN public.exam_seating_plans p ON ((p.id = a.plan_id)))
     JOIN public.exam_seating_rooms r ON ((r.id = a.room_id)));





CREATE TRIGGER duty_board_updated_at BEFORE UPDATE ON public.duty_board FOR EACH ROW EXECUTE FUNCTION public.update_duty_board_timestamp();




CREATE TRIGGER set_attendance_daily_stats_updated_at BEFORE UPDATE ON public.attendance_daily_stats FOR EACH ROW EXECUTE FUNCTION public.update_attendance_daily_stats_updated_at();




CREATE TRIGGER set_attendance_thresholds_updated_at BEFORE UPDATE ON public.attendance_thresholds FOR EACH ROW EXECUTE FUNCTION public.update_attendance_thresholds_updated_at();




CREATE TRIGGER set_generated_id_cards_updated_at BEFORE UPDATE ON public.generated_id_cards FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();




CREATE TRIGGER srs_auto_enrol AFTER INSERT ON public.note_wrong_answers FOR EACH ROW EXECUTE FUNCTION public.enrol_srs_on_wrong_answer();




CREATE TRIGGER timetable_updated_at BEFORE UPDATE ON public.timetables FOR EACH ROW EXECUTE FUNCTION public.update_timetable_timestamp();




CREATE TRIGGER trg_achievement_notify AFTER INSERT ON public.achievements FOR EACH ROW EXECUTE FUNCTION public.trg_fn_achievement_notify();




CREATE TRIGGER trg_admission_application_notify AFTER INSERT ON public.admissions FOR EACH ROW EXECUTE FUNCTION public.trg_fn_admission_application_notify();




CREATE TRIGGER trg_admission_doc_notify AFTER INSERT ON public.admission_documents FOR EACH ROW EXECUTE FUNCTION public.trg_fn_admission_doc_notify();




CREATE TRIGGER trg_admission_open_notify AFTER UPDATE ON public.admission_settings FOR EACH ROW EXECUTE FUNCTION public.trg_fn_admission_open_notify();




CREATE TRIGGER trg_auto_link_student_user_id BEFORE INSERT ON public.students FOR EACH ROW EXECUTE FUNCTION public.auto_link_student_user_id();




CREATE TRIGGER trg_chapter_answers_updated_at BEFORE UPDATE ON public.chapter_answers FOR EACH ROW EXECUTE FUNCTION public.trg_fn_set_updated_at();




CREATE TRIGGER trg_chapter_question_notify AFTER INSERT ON public.chapter_questions FOR EACH ROW EXECUTE FUNCTION public.trg_fn_chapter_question_notify();




CREATE TRIGGER trg_chapter_questions_updated_at BEFORE UPDATE ON public.chapter_questions FOR EACH ROW EXECUTE FUNCTION public.trg_fn_set_updated_at();




CREATE TRIGGER trg_contact_message_notify AFTER INSERT ON public.contact_messages FOR EACH ROW EXECUTE FUNCTION public.trg_fn_contact_message_notify();




CREATE TRIGGER trg_event_notify AFTER INSERT ON public.school_events FOR EACH ROW EXECUTE FUNCTION public.trg_fn_event_notify();




CREATE TRIGGER trg_exam_roll_notify AFTER UPDATE ON public.exam_roll_sessions FOR EACH ROW EXECUTE FUNCTION public.trg_fn_exam_roll_notify();




CREATE TRIGGER trg_exam_seating_notify AFTER INSERT OR UPDATE ON public.exam_seating_plans FOR EACH ROW EXECUTE FUNCTION public.trg_fn_exam_seating_notify();




CREATE TRIGGER trg_fee_structures_updated BEFORE UPDATE ON public.fee_structures FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();




CREATE TRIGGER trg_fee_voucher_notify AFTER INSERT ON public.fee_vouchers FOR EACH ROW EXECUTE FUNCTION public.trg_fn_fee_voucher_notify();




CREATE TRIGGER trg_fee_vouchers_updated BEFORE UPDATE ON public.fee_vouchers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();




CREATE TRIGGER trg_gallery_notify AFTER INSERT ON public.gallery_photos FOR EACH ROW EXECUTE FUNCTION public.trg_fn_gallery_notify();




CREATE TRIGGER trg_generate_admission_ref BEFORE INSERT ON public.admissions FOR EACH ROW EXECUTE FUNCTION public.generate_admission_reference();




CREATE TRIGGER trg_homework_notify AFTER INSERT ON public.homework FOR EACH ROW EXECUTE FUNCTION public.trg_fn_homework_notify();




CREATE TRIGGER trg_id_card_notify AFTER INSERT ON public.generated_id_cards FOR EACH ROW EXECUTE FUNCTION public.trg_fn_id_card_notify();




CREATE TRIGGER trg_interview_slots_touch BEFORE UPDATE ON public.interview_slots FOR EACH ROW EXECUTE FUNCTION public.touch_admissions_updated_at();




CREATE TRIGGER trg_lab_content_cache_updated_at BEFORE UPDATE ON public.lab_content_cache FOR EACH ROW EXECUTE FUNCTION public.set_lab_content_cache_updated_at();




CREATE TRIGGER trg_library_book_notify AFTER INSERT ON public.library_books FOR EACH ROW EXECUTE FUNCTION public.trg_fn_library_book_notify();




CREATE TRIGGER trg_merit_lists_updated_at BEFORE UPDATE ON public.merit_lists FOR EACH ROW EXECUTE FUNCTION public.set_merit_lists_updated_at();




CREATE TRIGGER trg_mistake_report_notify AFTER INSERT ON public.mistake_reports FOR EACH ROW EXECUTE FUNCTION public.trg_fn_mistake_report_notify();




CREATE TRIGGER trg_mistake_reports_updated_at BEFORE UPDATE ON public.mistake_reports FOR EACH ROW EXECUTE FUNCTION public.trg_fn_set_updated_at();




CREATE TRIGGER trg_news_notify AFTER INSERT ON public.news FOR EACH ROW EXECUTE FUNCTION public.trg_fn_news_notify();




CREATE TRIGGER trg_note_annotations_updated BEFORE UPDATE ON public.note_annotations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();




CREATE TRIGGER trg_notes_chapter_notify AFTER INSERT ON public.note_chapters FOR EACH ROW EXECUTE FUNCTION public.trg_fn_notes_chapter_notify();




CREATE TRIGGER trg_notes_feedback_notify AFTER INSERT ON public.note_annotations FOR EACH ROW EXECUTE FUNCTION public.trg_fn_notes_feedback_notify();




CREATE TRIGGER trg_notice_notify AFTER INSERT ON public.notices FOR EACH ROW EXECUTE FUNCTION public.trg_fn_notice_notify();




CREATE TRIGGER trg_online_class_notify AFTER INSERT ON public.online_classes FOR EACH ROW EXECUTE FUNCTION public.trg_fn_online_class_notify();




CREATE TRIGGER trg_result_notify AFTER INSERT OR UPDATE ON public.results FOR EACH ROW EXECUTE FUNCTION public.trg_fn_result_notify();




CREATE TRIGGER trg_rooms_updated_at BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.update_timetable_settings_updated_at();




CREATE TRIGGER trg_school_events_updated_at BEFORE UPDATE ON public.school_events FOR EACH ROW EXECUTE FUNCTION public.update_school_events_updated_at();




CREATE TRIGGER trg_seating_plans_touch BEFORE UPDATE ON public.exam_seating_plans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();




CREATE TRIGGER trg_seating_rooms_touch BEFORE UPDATE ON public.exam_seating_rooms FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();




CREATE TRIGGER trg_student_records_touch BEFORE UPDATE ON public.student_records FOR EACH ROW EXECUTE FUNCTION public.fn_student_records_touch_updated_at();




CREATE TRIGGER trg_timetable_notify AFTER INSERT ON public.timetables FOR EACH ROW EXECUTE FUNCTION public.trg_fn_timetable_notify_dedupe();




CREATE TRIGGER trg_touch_admissions BEFORE UPDATE ON public.admissions FOR EACH ROW EXECUTE FUNCTION public.touch_admissions_updated_at();




CREATE TRIGGER trg_video_notify AFTER INSERT ON public.videos FOR EACH ROW EXECUTE FUNCTION public.trg_fn_video_notify();




CREATE POLICY "Admin all chapters" ON public.note_chapters TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY "Admin all questions" ON public.note_questions TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY "Admin all quizzes" ON public.note_quizzes TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY "Admin and teachers can insert exam attendance" ON public.exam_attendance FOR INSERT TO authenticated WITH CHECK (true);




CREATE POLICY "Admin and teachers can update exam attendance" ON public.exam_attendance FOR UPDATE TO authenticated USING (true) WITH CHECK (true);




CREATE POLICY "Admin can delete exam attendance" ON public.exam_attendance FOR DELETE TO authenticated USING (true);




CREATE POLICY "Admin reads all times" ON public.chapter_reading_times FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY "Admin reads reports" ON public.mistake_reports FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY "Admin updates reports" ON public.mistake_reports FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY "Admin write connections" ON public.chapter_connections TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY "Admin write daily challenge" ON public.daily_challenge TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY "Admin write flashcards" ON public.note_flashcards TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY "Admin write subjects" ON public.note_subjects TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY "Admins and teachers can manage attendance" ON public.attendance TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text])) AND (profiles.status = 'approved'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text])) AND (profiles.status = 'approved'::text)))));




CREATE POLICY "Admins and teachers see all annotations" ON public.note_annotations FOR SELECT TO authenticated USING (((auth.jwt() ->> 'user_role'::text) = ANY (ARRAY['admin'::text, 'teacher'::text])));




CREATE POLICY "Admins can delete achievements" ON public.achievements FOR DELETE USING ((auth.role() = 'authenticated'::text));




CREATE POLICY "Admins can delete messages" ON public.discussion_messages FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY "Admins can delete school_events" ON public.school_events FOR DELETE USING ((auth.role() = 'authenticated'::text));




CREATE POLICY "Admins can manage attendance stats" ON public.attendance_daily_stats TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY "Admins can manage chapters" ON public.note_chapters TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY "Admins can manage events" ON public.school_events TO authenticated USING (((auth.jwt() ->> 'user_role'::text) = 'admin'::text)) WITH CHECK (((auth.jwt() ->> 'user_role'::text) = 'admin'::text));




CREATE POLICY "Admins can manage houses" ON public.houses TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY "Admins can manage quizzes" ON public.note_quizzes TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY "Admins can manage subjects" ON public.note_subjects TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY "Admins full access to id cards" ON public.generated_id_cards TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY "Admins manage attendance" ON public.attendance TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY "Admins manage daily challenge" ON public.daily_challenge TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY "Admins manage flashcards" ON public.note_flashcards TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY "Admins manage house members" ON public.house_members TO authenticated USING (((auth.jwt() ->> 'user_role'::text) = 'admin'::text)) WITH CHECK (((auth.jwt() ->> 'user_role'::text) = 'admin'::text));




CREATE POLICY "Admins manage houses" ON public.houses TO authenticated USING (((auth.jwt() ->> 'user_role'::text) = 'admin'::text)) WITH CHECK (((auth.jwt() ->> 'user_role'::text) = 'admin'::text));




CREATE POLICY "Admins manage questions" ON public.note_questions TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY "Admins manage rooms" ON public.rooms TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY "Admins manage thresholds" ON public.attendance_thresholds TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY "Admins see all progress" ON public.note_progress FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY "Annotations visible to owner, shared/public to all, admin all" ON public.note_annotations FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (visibility = ANY (ARRAY['shared'::text, 'public'::text])) OR ((auth.jwt() ->> 'user_role'::text) = 'admin'::text)));




CREATE POLICY "Anyone authenticated can read exam attendance" ON public.exam_attendance FOR SELECT TO authenticated USING (true);




CREATE POLICY "Anyone can insert site visits" ON public.site_visits FOR INSERT WITH CHECK (true);




CREATE POLICY "Anyone can read daily quizzes" ON public.daily_quizzes FOR SELECT TO authenticated, anon USING (true);




CREATE POLICY "Anyone can read discussion" ON public.discussion_messages FOR SELECT TO authenticated USING (true);




CREATE POLICY "Anyone can read fee_structures" ON public.fee_structures FOR SELECT USING (true);




CREATE POLICY "Anyone can view house members" ON public.house_members FOR SELECT USING (true);




CREATE POLICY "Anyone can view houses" ON public.houses FOR SELECT USING (true);




CREATE POLICY "Attendance readable by all" ON public.attendance FOR SELECT USING (true);




CREATE POLICY "Attendance readable by authenticated" ON public.attendance FOR SELECT TO authenticated USING (true);




CREATE POLICY "Attendance stats readable by all" ON public.attendance_daily_stats FOR SELECT USING (true);




CREATE POLICY "Auth users ask" ON public.chapter_questions FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Auth users create groups" ON public.study_groups FOR INSERT TO authenticated WITH CHECK (true);




CREATE POLICY "Authenticated users can delete fee_payments" ON public.fee_payments FOR DELETE USING ((auth.uid() IS NOT NULL));




CREATE POLICY "Authenticated users can delete fee_structures" ON public.fee_structures FOR DELETE USING ((auth.uid() IS NOT NULL));




CREATE POLICY "Authenticated users can delete fee_vouchers" ON public.fee_vouchers FOR DELETE USING ((auth.uid() IS NOT NULL));




CREATE POLICY "Authenticated users can insert fee_payments" ON public.fee_payments FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));




CREATE POLICY "Authenticated users can insert fee_structures" ON public.fee_structures FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));




CREATE POLICY "Authenticated users can insert fee_vouchers" ON public.fee_vouchers FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));




CREATE POLICY "Authenticated users can manage achievements" ON public.achievements USING ((auth.role() = 'authenticated'::text));




CREATE POLICY "Authenticated users can manage daily_quotes" ON public.daily_quotes USING ((auth.role() = 'authenticated'::text));




CREATE POLICY "Authenticated users can manage exam_schedule" ON public.exam_schedule USING ((auth.role() = 'authenticated'::text));




CREATE POLICY "Authenticated users can manage honor_roll" ON public.honor_roll USING ((auth.role() = 'authenticated'::text));




CREATE POLICY "Authenticated users can manage merit lists" ON public.merit_lists USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));




CREATE POLICY "Authenticated users can manage merit_lists" ON public.merit_lists USING ((auth.role() = 'authenticated'::text));




CREATE POLICY "Authenticated users can read fee_payments" ON public.fee_payments FOR SELECT USING ((auth.uid() IS NOT NULL));




CREATE POLICY "Authenticated users can read fee_vouchers" ON public.fee_vouchers FOR SELECT USING ((auth.uid() IS NOT NULL));




CREATE POLICY "Authenticated users can read site visits" ON public.site_visits FOR SELECT USING ((auth.uid() IS NOT NULL));




CREATE POLICY "Authenticated users can read students" ON public.students FOR SELECT USING ((auth.uid() IS NOT NULL));




CREATE POLICY "Authenticated users can seed daily quiz" ON public.daily_quizzes FOR INSERT TO authenticated WITH CHECK (true);




CREATE POLICY "Authenticated users can update fee_payments" ON public.fee_payments FOR UPDATE USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));




CREATE POLICY "Authenticated users can update fee_structures" ON public.fee_structures FOR UPDATE USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));




CREATE POLICY "Authenticated users can update fee_vouchers" ON public.fee_vouchers FOR UPDATE USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));




CREATE POLICY "Authenticated users can update house points" ON public.houses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);




CREATE POLICY "Authenticated users can view" ON public.students FOR SELECT TO authenticated USING (true);




CREATE POLICY "Authenticated users see leaderboard" ON public.student_gamification FOR SELECT TO authenticated USING (true);




CREATE POLICY "House members visible to all" ON public.house_members FOR SELECT USING (true);




CREATE POLICY "Houses visible to all" ON public.houses FOR SELECT USING (true);




CREATE POLICY "Logged in users can post" ON public.discussion_messages FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Members see group" ON public.study_group_members FOR SELECT TO authenticated USING (true);




CREATE POLICY "Members visible to authenticated" ON public.house_members FOR SELECT TO authenticated USING (true);




CREATE POLICY "No anonymous access" ON public.results TO anon USING (false);




CREATE POLICY "No anonymous access" ON public.students TO anon USING (false);




CREATE POLICY "No anonymous access" ON public.teachers TO anon USING (false);




CREATE POLICY "No one can delete site visits" ON public.site_visits FOR DELETE USING (false);




CREATE POLICY "No one can update site visits" ON public.site_visits FOR UPDATE USING (false) WITH CHECK (false);




CREATE POLICY "Owner or admin can delete annotation" ON public.note_annotations FOR DELETE TO authenticated USING (((user_id = auth.uid()) OR ((auth.jwt() ->> 'user_role'::text) = 'admin'::text)));




CREATE POLICY "Owner or admin can update annotation" ON public.note_annotations FOR UPDATE TO authenticated USING (((user_id = auth.uid()) OR ((auth.jwt() ->> 'user_role'::text) = 'admin'::text) OR (visibility = ANY (ARRAY['shared'::text, 'public'::text])))) WITH CHECK (((user_id = auth.uid()) OR ((auth.jwt() ->> 'user_role'::text) = 'admin'::text) OR (visibility = ANY (ARRAY['shared'::text, 'public'::text]))));




CREATE POLICY "Public can read achievements" ON public.achievements FOR SELECT USING (true);




CREATE POLICY "Public can read daily_quotes" ON public.daily_quotes FOR SELECT USING (true);




CREATE POLICY "Public can read published exam_schedule" ON public.exam_schedule FOR SELECT USING ((is_published = true));




CREATE POLICY "Public can read published honor_roll" ON public.honor_roll FOR SELECT USING ((is_published = true));




CREATE POLICY "Public can read published merit_lists" ON public.merit_lists FOR SELECT USING ((is_published = true));




CREATE POLICY "Public leaderboard read" ON public.student_gamification FOR SELECT USING (true);




CREATE POLICY "Public read answers" ON public.chapter_answers FOR SELECT USING (true);




CREATE POLICY "Public read chapters" ON public.note_chapters FOR SELECT USING ((is_published = true));




CREATE POLICY "Public read connections" ON public.chapter_connections FOR SELECT USING (true);




CREATE POLICY "Public read daily challenge" ON public.daily_challenge FOR SELECT USING (true);




CREATE POLICY "Public read flashcards" ON public.note_flashcards FOR SELECT USING (true);




CREATE POLICY "Public read groups" ON public.study_groups FOR SELECT USING (true);




CREATE POLICY "Public read questions" ON public.chapter_questions FOR SELECT USING (true);




CREATE POLICY "Public read questions" ON public.note_questions FOR SELECT USING (true);




CREATE POLICY "Public read quizzes" ON public.note_quizzes FOR SELECT USING ((is_active = true));




CREATE POLICY "Public read ratings" ON public.note_ratings FOR SELECT USING (true);




CREATE POLICY "Public read subjects" ON public.note_subjects FOR SELECT USING (true);




CREATE POLICY "Published events visible to all" ON public.school_events FOR SELECT USING ((is_published = true));




CREATE POLICY "Published merit lists are viewable by everyone" ON public.merit_lists FOR SELECT USING (true);




CREATE POLICY "Rooms readable by all" ON public.rooms FOR SELECT USING (true);




CREATE POLICY "Shared annotations visible" ON public.note_annotations FOR SELECT TO authenticated USING ((visibility = ANY (ARRAY['shared'::text, 'public'::text])));




CREATE POLICY "Students can view all generated id cards" ON public.generated_id_cards FOR SELECT TO authenticated USING (true);




CREATE POLICY "Students create annotations" ON public.note_annotations FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));




CREATE POLICY "Students delete own annotations" ON public.note_annotations FOR DELETE TO authenticated USING ((auth.uid() = user_id));




CREATE POLICY "Students join a house" ON public.house_members FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));




CREATE POLICY "Students see own annotations" ON public.note_annotations FOR SELECT TO authenticated USING ((auth.uid() = user_id));




CREATE POLICY "Students switch their own house" ON public.house_members FOR DELETE TO authenticated USING ((auth.uid() = user_id));




CREATE POLICY "Students update own annotations" ON public.note_annotations FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));




CREATE POLICY "Teachers answer" ON public.chapter_answers FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))));




CREATE POLICY "Teachers see student results" ON public.note_quiz_results FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'teacher'::text)))));




CREATE POLICY "Thresholds readable by all" ON public.attendance_thresholds FOR SELECT USING (true);




CREATE POLICY "Upvotes visible to all authenticated" ON public.annotation_upvotes FOR SELECT TO authenticated USING (true);




CREATE POLICY "Users can create their own annotations" ON public.note_annotations FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Users can insert their own daily quiz attempt" ON public.daily_quiz_attempts FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));




CREATE POLICY "Users can manage own membership" ON public.house_members TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));




CREATE POLICY "Users can read all daily quiz attempts" ON public.daily_quiz_attempts FOR SELECT TO authenticated USING (true);




CREATE POLICY "Users can read own messages" ON public.user_messages FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY "Users can report" ON public.mistake_reports FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Users can send messages" ON public.user_messages FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY "Users create upvotes" ON public.annotation_upvotes FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));




CREATE POLICY "Users delete own upvotes" ON public.annotation_upvotes FOR DELETE TO authenticated USING ((auth.uid() = user_id));




CREATE POLICY "Users join houses" ON public.house_members FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));




CREATE POLICY "Users manage their own upvote" ON public.annotation_upvotes TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Users own challenge answers" ON public.daily_challenge_answers TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Users own flashcard progress" ON public.note_flashcard_progress TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Users own gamification" ON public.student_gamification TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Users own highlights" ON public.note_highlights TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Users own membership" ON public.study_group_members TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Users own quiz results" ON public.note_quiz_results TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))))) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Users own ratings" ON public.note_ratings TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Users own reading times" ON public.chapter_reading_times TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Users own reminders" ON public.revision_reminders TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Users own wrong answers" ON public.note_wrong_answers TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY "Users read own progress" ON public.note_progress FOR SELECT TO authenticated USING ((user_id = auth.uid()));




CREATE POLICY "Users see upvotes" ON public.annotation_upvotes FOR SELECT TO authenticated USING (true);




CREATE POLICY "Users update upvotes" ON public.chapter_questions FOR UPDATE TO authenticated USING (true);




CREATE POLICY "Users write own progress" ON public.note_progress TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY achievements_admin_all ON public.achievements TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY achievements_public_read ON public.achievements FOR SELECT USING (true);




CREATE POLICY admin_all_profiles ON public.profiles TO authenticated USING ((((auth.jwt() ->> 'user_role'::text) = 'admin'::text) OR (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))) WITH CHECK ((((auth.jwt() ->> 'user_role'::text) = 'admin'::text) OR (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));




CREATE POLICY admin_read_all_profiles ON public.profiles FOR SELECT TO authenticated USING (true);




CREATE POLICY admin_update_all_profiles ON public.profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);




CREATE POLICY admin_update_school_settings ON public.school_settings TO authenticated USING ((((auth.jwt() ->> 'user_role'::text) = 'admin'::text) OR (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))) WITH CHECK ((((auth.jwt() ->> 'user_role'::text) = 'admin'::text) OR (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));




CREATE POLICY admins_manage_charges ON public.student_charges USING (public.is_admin());




CREATE POLICY admins_manage_fee_types ON public.fee_types USING (public.is_admin());




CREATE POLICY admins_manage_items ON public.payment_items USING (public.is_admin());




CREATE POLICY admins_manage_payments ON public.payments USING (public.is_admin());




CREATE POLICY admins_manage_receipts ON public.receipts USING (public.is_admin());




CREATE POLICY admission_docs_admin_all ON public.admission_documents USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY admission_docs_public_insert ON public.admission_documents FOR INSERT TO authenticated, anon WITH CHECK (true);




CREATE POLICY admission_docs_public_select ON public.admission_documents FOR SELECT TO authenticated, anon USING (true);




CREATE POLICY admissions_admin_all ON public.admissions USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY admissions_public_insert ON public.admissions FOR INSERT TO authenticated, anon WITH CHECK (true);




CREATE POLICY admissions_public_select ON public.admissions FOR SELECT TO authenticated, anon USING (true);




CREATE POLICY admissions_public_select_own ON public.admissions FOR SELECT TO authenticated, anon USING (true);




CREATE POLICY admissions_self_select ON public.admissions FOR SELECT TO authenticated, anon USING (true);




CREATE POLICY "attempts admin teacher read" ON public.test_attempts FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY "attempts own" ON public.test_attempts USING ((auth.uid() = user_id));




CREATE POLICY attendance_auth_read ON public.attendance FOR SELECT USING ((auth.uid() IS NOT NULL));




CREATE POLICY attendance_student_own ON public.attendance FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.students
  WHERE ((students.user_id = auth.uid()) AND (students.id = attendance.student_id)))));




CREATE POLICY bookings_insert_anon ON public.interview_bookings FOR INSERT TO authenticated, anon WITH CHECK (true);




CREATE POLICY bookings_read_public_own ON public.interview_bookings FOR SELECT TO authenticated, anon USING ((cancelled_at IS NULL));




CREATE POLICY bookings_read_staff ON public.interview_bookings FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY bookings_update_anon ON public.interview_bookings FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);




CREATE POLICY chapter_answers_admin_delete ON public.chapter_answers FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY chapter_answers_delete_own_or_admin ON public.chapter_answers FOR DELETE TO authenticated USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY chapter_answers_insert_own ON public.chapter_answers FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));




CREATE POLICY chapter_answers_insert_staff ON public.chapter_answers FOR INSERT TO authenticated WITH CHECK (((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))));




CREATE POLICY chapter_answers_modify_own_or_admin ON public.chapter_answers FOR UPDATE TO authenticated USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))))) WITH CHECK (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY chapter_answers_read_all ON public.chapter_answers FOR SELECT TO authenticated, anon USING (true);




CREATE POLICY chapter_answers_select_all ON public.chapter_answers FOR SELECT TO authenticated USING (true);




CREATE POLICY chapter_questions_admin_delete ON public.chapter_questions FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY chapter_questions_delete_own_or_admin ON public.chapter_questions FOR DELETE TO authenticated USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY chapter_questions_insert_own ON public.chapter_questions FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));




CREATE POLICY chapter_questions_read_all ON public.chapter_questions FOR SELECT TO authenticated, anon USING (true);




CREATE POLICY chapter_questions_select_all ON public.chapter_questions FOR SELECT TO authenticated USING (true);




CREATE POLICY chapter_questions_update_own_or_staff ON public.chapter_questions FOR UPDATE TO authenticated USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))))) WITH CHECK (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))));




CREATE POLICY chapter_questions_update_upvote ON public.chapter_questions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);




CREATE POLICY completion_all ON public.homework_completions TO authenticated USING (((student_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))))) WITH CHECK (((student_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))));




CREATE POLICY contact_messages_admin_delete ON public.contact_messages FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY contact_messages_admin_select ON public.contact_messages FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY contact_messages_admin_update ON public.contact_messages FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY contact_messages_insert_anyone ON public.contact_messages FOR INSERT TO authenticated, anon WITH CHECK (true);




CREATE POLICY daily_quotes_public ON public.daily_quotes FOR SELECT USING (true);




CREATE POLICY dismissals_own_delete ON public.notification_dismissals FOR DELETE TO authenticated USING ((auth.uid() = user_id));




CREATE POLICY dismissals_own_insert ON public.notification_dismissals FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));




CREATE POLICY dismissals_own_select ON public.notification_dismissals FOR SELECT TO authenticated USING ((auth.uid() = user_id));




CREATE POLICY dismissed_notifications_owner_all ON public.dismissed_notifications TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY duty_board_admin_write ON public.duty_board USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY duty_board_public_read ON public.duty_board FOR SELECT USING (true);




CREATE POLICY exam_rollnumbers_admin_all ON public.exam_roll_numbers USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY exam_rollnumbers_auth_read ON public.exam_roll_numbers FOR SELECT USING ((auth.uid() IS NOT NULL));




CREATE POLICY exam_rollnumbers_public_read ON public.exam_roll_numbers FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.exam_roll_sessions s
  WHERE ((s.id = exam_roll_numbers.session_id) AND (s.is_published = true)))));




CREATE POLICY exam_schedule_public ON public.exam_schedule FOR SELECT USING (true);




CREATE POLICY exam_sessions_admin_all ON public.exam_roll_sessions USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY exam_sessions_auth_read ON public.exam_roll_sessions FOR SELECT USING ((auth.uid() IS NOT NULL));




CREATE POLICY exam_sessions_public_read ON public.exam_roll_sessions FOR SELECT USING ((is_published = true));




CREATE POLICY fp_admin_all ON public.fee_payments USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY fp_any_user_read ON public.fee_payments FOR SELECT TO authenticated USING (true);




CREATE POLICY fp_student_class_read ON public.fee_payments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.fee_vouchers fv
     JOIN public.profiles p ON ((p.id = auth.uid())))
  WHERE ((fv.id = fee_payments.voucher_id) AND (fv.class = p.class)))));




CREATE POLICY fp_student_own ON public.fee_payments FOR SELECT USING ((student_id IN ( SELECT students.id
   FROM public.students
  WHERE (students.user_id = auth.uid()))));




CREATE POLICY fs_admin_all ON public.fee_structures USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY fs_any_user_read ON public.fee_structures FOR SELECT TO authenticated USING (true);




CREATE POLICY fs_read_all ON public.fee_structures FOR SELECT TO authenticated USING (true);




CREATE POLICY fs_student_class_read ON public.fee_structures FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.class IS NOT NULL) AND (profiles.class = fee_structures.class)))));




CREATE POLICY fs_student_read ON public.fee_structures FOR SELECT USING (((EXISTS ( SELECT 1
   FROM auth.users
  WHERE (auth.uid() = users.id))) AND ((class = ( SELECT profiles.class
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) OR (class = ( SELECT students.class
   FROM public.students
  WHERE (students.user_id = auth.uid()))))));




CREATE POLICY fv_admin_all ON public.fee_vouchers USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY fv_anon_admission_read ON public.fee_vouchers FOR SELECT TO authenticated, anon USING (((fee_period = 'one_off'::text) AND (status IS NOT NULL)));




CREATE POLICY fv_anon_tracker_read ON public.fee_vouchers FOR SELECT TO anon USING (true);




CREATE POLICY fv_any_user_read ON public.fee_vouchers FOR SELECT TO authenticated USING (true);




CREATE POLICY fv_public_admission_tracker_read ON public.fee_vouchers FOR SELECT TO anon USING (((fee_period = 'one_off'::text) AND (EXISTS ( SELECT 1
   FROM jsonb_array_elements(fee_vouchers.fee_items) item(value)
  WHERE ((item.value ->> 'fee_type'::text) = ANY (ARRAY['admission'::text, 'migration'::text]))))));




CREATE POLICY fv_student_class_read ON public.fee_vouchers FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM auth.users
  WHERE (auth.uid() = users.id))) AND ((class = ( SELECT profiles.class
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) OR (class = ( SELECT students.class
   FROM public.students
  WHERE (students.user_id = auth.uid()))))));




CREATE POLICY fv_student_own ON public.fee_vouchers FOR SELECT USING ((student_id IN ( SELECT students.id
   FROM public.students
  WHERE (students.user_id = auth.uid()))));




CREATE POLICY gallery_admin_all ON public.gallery_albums TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY gallery_albums_admin_all ON public.gallery_albums USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY gallery_albums_public ON public.gallery_albums FOR SELECT USING (true);




CREATE POLICY gallery_albums_public_read ON public.gallery_albums FOR SELECT USING (true);




CREATE POLICY gallery_photos_admin_all ON public.gallery_photos TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY gallery_photos_public ON public.gallery_photos FOR SELECT USING (true);




CREATE POLICY gallery_photos_public_read ON public.gallery_photos FOR SELECT USING (true);




CREATE POLICY homework_admin_teacher_all ON public.homework TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY homework_authenticated_read ON public.homework FOR SELECT TO authenticated USING (true);




CREATE POLICY homework_read ON public.homework FOR SELECT TO authenticated USING ((is_active = true));




CREATE POLICY homework_write ON public.homework TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY honor_read ON public.honor_roll FOR SELECT USING ((is_published = true));




CREATE POLICY honor_roll_public ON public.honor_roll FOR SELECT USING (true);




CREATE POLICY honor_write ON public.honor_roll TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY lab_content_cache_public_read ON public.lab_content_cache FOR SELECT TO authenticated, anon USING (true);




CREATE POLICY library_admin_all ON public.library_files TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY library_files_admin_all ON public.library_files USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY library_files_auth_update_downloads ON public.library_files FOR UPDATE USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));




CREATE POLICY library_files_public_read ON public.library_files FOR SELECT USING (true);




CREATE POLICY library_public_read ON public.library_files FOR SELECT USING (true);




CREATE POLICY merit_lists_admin_all ON public.merit_lists TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY merit_lists_public_read ON public.merit_lists FOR SELECT USING (true);




CREATE POLICY merit_read ON public.merit_lists FOR SELECT TO authenticated USING ((is_published = true));




CREATE POLICY merit_write ON public.merit_lists TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY mistake_reports_admin_delete ON public.mistake_reports FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY mistake_reports_delete_admin ON public.mistake_reports FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY mistake_reports_insert_own ON public.mistake_reports FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));




CREATE POLICY mistake_reports_read_all ON public.mistake_reports FOR SELECT TO authenticated, anon USING (true);




CREATE POLICY mistake_reports_staff_select ON public.mistake_reports FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY mistake_reports_staff_update ON public.mistake_reports FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY mistake_reports_update_staff ON public.mistake_reports FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY news_admin_all ON public.news TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY news_admin_read_all ON public.news FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY news_admin_write ON public.news USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY news_public_read ON public.news FOR SELECT USING (true);




CREATE POLICY notices_admin_all ON public.notices TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY notices_admin_read_all ON public.notices FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY notices_admin_write ON public.notices USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY notices_public_read ON public.notices FOR SELECT USING (true);




CREATE POLICY notification_dismissals_own ON public.notification_dismissals TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY notifications_admin_delete ON public.notifications FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY notifications_admin_write ON public.notifications TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY notifications_select_v2 ON public.notifications FOR SELECT TO authenticated USING (((((audience = 'all'::text) AND (NOT (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))))) OR ((audience = 'admin'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) OR ((audience = 'students'::text) AND (NOT (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))))) OR ((audience ~~ 'class:%'::text) AND (audience = ('class:'::text || ( SELECT profiles.class
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))))) OR ((audience ~~ 'user:%'::text) AND (audience = ('user:'::text || (auth.uid())::text)))) AND (NOT (EXISTS ( SELECT 1
   FROM public.dismissed_notifications dn
  WHERE ((dn.notification_id = notifications.id) AND (dn.user_id = auth.uid())))))));




CREATE POLICY notifications_user_insert ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);




CREATE POLICY notifications_user_update_read ON public.notifications FOR UPDATE TO authenticated USING ((((audience = 'all'::text) AND (NOT (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))))) OR ((audience = 'admin'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) OR ((audience = 'students'::text) AND (NOT (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))))) OR ((audience ~~ 'class:%'::text) AND (audience = ('class:'::text || ( SELECT profiles.class
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))))) OR ((audience ~~ 'user:%'::text) AND (audience = ('user:'::text || (auth.uid())::text))))) WITH CHECK (true);




CREATE POLICY otp_insert_anon ON public.admission_otp_codes FOR INSERT TO authenticated, anon WITH CHECK (true);




CREATE POLICY otp_update_anon ON public.admission_otp_codes FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);




CREATE POLICY own_profile_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK ((auth.uid() = id));




CREATE POLICY own_profile_select ON public.profiles FOR SELECT TO authenticated USING ((auth.uid() = id));




CREATE POLICY own_profile_update ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));




CREATE POLICY poll_votes_admin_all ON public.poll_votes TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY poll_votes_no_direct_insert ON public.poll_votes FOR INSERT TO authenticated, anon WITH CHECK (false);




CREATE POLICY poll_votes_select_all ON public.poll_votes FOR SELECT TO authenticated, anon USING (true);




CREATE POLICY public_read_school_settings ON public.school_settings FOR SELECT USING (true);




CREATE POLICY "questions admin teacher all" ON public.test_questions USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY "questions auth read" ON public.test_questions FOR SELECT USING ((auth.role() = 'authenticated'::text));




CREATE POLICY quotes_read ON public.daily_quotes FOR SELECT USING ((is_active = true));




CREATE POLICY quotes_write ON public.daily_quotes TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY results_admin_all ON public.results TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY results_public_read ON public.results FOR SELECT USING (true);




CREATE POLICY results_published_public ON public.results FOR SELECT USING ((is_published = true));




CREATE POLICY schedule_read ON public.exam_schedule FOR SELECT USING ((is_published = true));




CREATE POLICY schedule_write ON public.exam_schedule TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY school_settings_authenticated_write ON public.school_settings TO authenticated USING (true) WITH CHECK (true);




CREATE POLICY school_settings_public_read ON public.school_settings FOR SELECT USING (true);




CREATE POLICY school_settings_read_all ON public.school_settings FOR SELECT USING (true);




CREATE POLICY seating_assign_read ON public.exam_seating_assignments FOR SELECT USING (true);




CREATE POLICY seating_assign_write ON public.exam_seating_assignments USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY seating_plans_read ON public.exam_seating_plans FOR SELECT USING (true);




CREATE POLICY seating_plans_write ON public.exam_seating_plans USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY seating_rooms_read ON public.exam_seating_rooms FOR SELECT USING (true);




CREATE POLICY seating_rooms_write ON public.exam_seating_rooms USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY settings_admin_all ON public.admission_settings USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY settings_read_all ON public.admission_settings FOR SELECT USING (true);




CREATE POLICY slots_read_public ON public.interview_slots FOR SELECT TO authenticated, anon USING ((is_active = true));




CREATE POLICY slots_read_staff_all ON public.interview_slots FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY slots_write_staff ON public.interview_slots TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY sms_outbox_admin_all ON public.sms_outbox TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY sr_admin_all ON public.student_records USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY srs_reviews_admin_all ON public.srs_reviews USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY srs_reviews_delete_own ON public.srs_reviews FOR DELETE TO authenticated USING ((user_id = auth.uid()));




CREATE POLICY srs_reviews_insert_own ON public.srs_reviews FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));




CREATE POLICY srs_reviews_read_own_or_staff ON public.srs_reviews FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))));




CREATE POLICY srs_reviews_select_own ON public.srs_reviews FOR SELECT USING ((auth.uid() = user_id));




CREATE POLICY srs_reviews_update_own ON public.srs_reviews FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY students_admin_all ON public.students TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY students_auth_read ON public.students FOR SELECT USING ((auth.uid() IS NOT NULL));




CREATE POLICY students_insert_payments ON public.payments FOR INSERT WITH CHECK ((student_id = auth.uid()));




CREATE POLICY students_own_charges ON public.student_charges FOR SELECT USING ((student_id = auth.uid()));




CREATE POLICY students_own_items ON public.payment_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.payments p
  WHERE ((p.id = payment_items.payment_id) AND (p.student_id = auth.uid())))));




CREATE POLICY students_own_payments ON public.payments FOR SELECT USING ((student_id = auth.uid()));




CREATE POLICY students_own_receipts ON public.receipts FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.payments p
  WHERE ((p.id = receipts.payment_id) AND (p.student_id = auth.uid())))));




CREATE POLICY students_public_read ON public.students FOR SELECT USING (true);




CREATE POLICY students_self_read_by_id ON public.students FOR SELECT TO authenticated USING ((id = auth.uid()));




CREATE POLICY students_self_read_by_user_id ON public.students FOR SELECT TO authenticated USING ((user_id = auth.uid()));




CREATE POLICY students_self_update_user_id ON public.students FOR UPDATE TO authenticated USING (((user_id = auth.uid()) OR (user_id IS NULL))) WITH CHECK ((user_id = auth.uid()));




CREATE POLICY teacher_view_profiles ON public.profiles FOR SELECT TO authenticated USING ((((auth.jwt() ->> 'user_role'::text) = 'teacher'::text) OR (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = 'teacher'::text)));




CREATE POLICY teachers_admin_all ON public.teachers TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY teachers_public_read ON public.teachers FOR SELECT USING (true);




CREATE POLICY test_attempts_own ON public.test_attempts TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));




CREATE POLICY "tests admin teacher all" ON public.tests USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'teacher'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY "tests public read published" ON public.tests FOR SELECT USING ((is_published = true));




CREATE POLICY tests_public_read ON public.tests FOR SELECT USING (true);




CREATE POLICY timeline_read_staff ON public.admission_status_timeline FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY timeline_write_staff ON public.admission_status_timeline FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'teacher'::text]))))));




CREATE POLICY timetable_overrides_delete ON public.timetable_overrides FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY timetable_overrides_insert ON public.timetable_overrides FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY timetable_overrides_select ON public.timetable_overrides FOR SELECT TO authenticated, anon USING (true);




CREATE POLICY timetable_overrides_update ON public.timetable_overrides FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY timetables_admin_all ON public.timetables TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));




CREATE POLICY timetables_public_read ON public.timetables FOR SELECT USING (true);




CREATE POLICY users_can_insert_own_profile ON public.profiles FOR INSERT TO authenticated WITH CHECK ((auth.uid() = id));




CREATE POLICY users_can_update_own_profile ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));




CREATE POLICY users_read_fee_types ON public.fee_types FOR SELECT USING ((auth.uid() IS NOT NULL));




CREATE POLICY "videos admin all" ON public.videos USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY "videos auth read" ON public.videos FOR SELECT USING ((auth.role() = 'authenticated'::text));




CREATE POLICY "videos public read" ON public.videos FOR SELECT USING ((is_published = true));




CREATE POLICY videos_admin_all ON public.videos USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))));




CREATE POLICY videos_public_read ON public.videos FOR SELECT USING ((is_published = true));
