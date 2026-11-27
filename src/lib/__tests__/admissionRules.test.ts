// src/lib/__tests__/admissionRules.test.ts — unit tests for the shared
// admission rules (board-compliance core of the apply form + checker).
import { describe, it, expect } from "vitest";
import {
  ageOn, checkAgeForClass, migrationAllowedForClass, isValidBForm, isValidPkMobile,
  marksPct, MIGRATION_STEPS, digitsOnly,
} from "../admissionRules";

// A fixed "today" so the age math never depends on the machine's clock.
const TODAY = new Date(2026, 10, 27); // 27 Nov 2026

describe("ageOn", () => {
  it("counts completed years", () => {
    expect(ageOn("2014-03-31", TODAY)).toBe(12);
    expect(ageOn("2014-04-01", TODAY)).toBe(12); // still 12 (birthday next March)
    expect(ageOn("2006-11-28", TODAY)).toBe(19); // birthday tomorrow
    expect(ageOn("2006-11-27", TODAY)).toBe(20);
  });
  it("returns NaN for garbage", () => {
    expect(Number.isNaN(ageOn("not-a-date", TODAY))).toBe(true);
  });
});

describe("checkAgeForClass — Class 9 (board rules)", () => {
  it("accepts the board cut-off exactly (DOB 31-03-2014)", () => {
    const r = checkAgeForClass("2014-03-31", "9", TODAY);
    expect(r.level).toBe("ok");
  });
  it("rejects DOB after 31-03-2014 (the old false-positive case)", () => {
    const r = checkAgeForClass("2014-09-01", "9", TODAY);
    expect(r.level).toBe("error");
    expect(r.message).toContain("BISE Peshawar");
  });
  it("rejects above the upper limit of 20 (the old false-negative case)", () => {
    // age 15 on TODAY — the OLD site wrongly rejected this within-board age
    const ok15 = checkAgeForClass("2011-09-01", "9", TODAY);
    expect(ok15.level).toBe("ok");
    // age 21 — above the board's limit
    const r = checkAgeForClass("2005-11-27", "9", TODAY);
    expect(r.level).toBe("error");
    expect(r.message).toContain("20");
  });
  it("requires a DOB", () => {
    expect(checkAgeForClass("", "9", TODAY).level).toBe("error");
    expect(checkAgeForClass(null, "9", TODAY).level).toBe("error");
  });
});

describe("checkAgeForClass — other classes (school guidance, warn not block)", () => {
  it("warns but never errors for class 6–8 / 10", () => {
    const r = checkAgeForClass("2010-01-01", "6", TODAY); // ~16 years in class 6
    expect(r.level).toBe("warn");
  });
  it("accepts typical ages", () => {
    expect(checkAgeForClass("2015-06-15", "6", TODAY).level).toBe("ok");
    expect(checkAgeForClass("2012-06-15", "8", TODAY).level).toBe("ok");
    expect(checkAgeForClass("2011-06-15", "10", TODAY).level).toBe("ok");
  });
});

describe("migrationAllowedForClass", () => {
  it("allows 9 and 10 only (BISEP portal migration)", () => {
    expect(migrationAllowedForClass("9")).toBe(true);
    expect(migrationAllowedForClass("10")).toBe(true);
    expect(migrationAllowedForClass("6")).toBe(false);
    expect(migrationAllowedForClass("8")).toBe(false);
  });
});

describe("B-Form / phone validation", () => {
  it("accepts dashes or digits for the B-Form", () => {
    expect(isValidBForm("31203-1234567-1")).toBe(true);
    expect(isValidBForm("3120312345671")).toBe(true);
    expect(isValidBForm("31203-1234567")).toBe(false);
  });
  it("accepts 03XXXXXXXXX phones only", () => {
    expect(isValidPkMobile("0300-1234567")).toBe(true);
    expect(isValidPkMobile("03001234567")).toBe(true);
    expect(isValidPkMobile("12345678901")).toBe(false);
  });
});

describe("marksPct (merit ranking)", () => {
  it("parses fractions, percentages, plain numbers", () => {
    expect(marksPct("450/600")).toBe(75);
    expect(marksPct("560/600")).toBe(93.33);
    expect(marksPct("82%")).toBe(82);
    expect(marksPct("82")).toBe(82);
    expect(marksPct("55.5%")).toBe(55.5);
  });
  it("letter grades rank last (null)", () => {
    expect(marksPct("A+")).toBeNull();
    expect(marksPct("")).toBeNull();
  });
  it("digitsOnly strips formatting", () => {
    expect(digitsOnly("31203-1234567-1")).toBe("3120312345671");
  });
});

describe("MIGRATION_STEPS (BISEP: receiving school applies)", () => {
  it("has 6 steps and names the receiving school as the applicant", () => {
    expect(MIGRATION_STEPS).toHaveLength(6);
    expect(MIGRATION_STEPS[2]).toContain("Our school (receiving school) applies");
    expect(MIGRATION_STEPS[3]).toContain("Previous school");
  });
});
