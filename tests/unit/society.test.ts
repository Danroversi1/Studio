import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyReport, parseCsv, parseEcb, parseEurostat, parseSce, parseUmich, SERIES, THEMES } from "../../lib/society/sources";
import { forPrompt, moods, moodWord, readingFor } from "../../lib/society/score";

test("every series is a survey of people with a theme, a direction and a source page", () => {
  for (const s of SERIES) {
    assert.ok(THEMES.includes(s.theme) && ["up", "down"].includes(s.better), s.id);
  }
  for (const region of ["US", "EU"]) for (const theme of THEMES) assert.ok(SERIES.some((s) => s.region === region && s.theme === theme), `${region} ${theme}`);
});

test("University of Michigan files (month names, trailing spaces in headers)", () => {
  const p = parseUmich("tbmiccice", "Month,YYYY,ICC,ICE \r\nOctober,2026,46.7,48.8 \r\nNovember,2026,49.4,52.9 \r\n");
  assert.deepEqual(p.filter((x) => x.period === "2026-11-01").map((x) => [x.series, x.value]), [["us.umich.current", 49.4], ["us.umich.expect", 52.9]]);
  assert.deepEqual(parseUmich("tbmics", "Month,YYYY,ICS_ALL\nNovember,2026,51.5\n").map((x) => x.value), [51.5]);
});

test("Eurostat JSON-stat: multi-indicator index decoding", () => {
  const json = {
    id: ["freq", "indic", "s_adj", "unit", "geo", "time"], size: [1, 2, 1, 1, 1, 2],
    value: { "0": -16.1, "1": -17.3, "2": 26.0, "3": 27.3 },
    dimension: {
      freq: { category: { index: { M: 0 } } }, indic: { category: { index: { "BS-CSMCI": 0, "BS-UE-NY": 1 } } }, s_adj: { category: { index: { SA: 0 } } },
      unit: { category: { index: { BAL: 0 } } }, geo: { category: { index: { EU27_2020: 0 } } }, time: { category: { index: { "2026-09": 0, "2026-10": 1 } } },
    },
  };
  const p = parseEurostat(json);
  assert.deepEqual(p.find((x) => x.series === "eu.ec.confidence" && x.period === "2026-10-01")?.value, -17.3);
  assert.deepEqual(p.find((x) => x.series === "eu.ec.unemp" && x.period === "2026-09-01")?.value, 26.0);
});

test("ECB CSV: quoted titles with commas; only monthly weighted medians", () => {
  const csv = `KEY,FREQ,TIME_PERIOD,OBS_VALUE,TITLE\nCES.M.Z18.ALL.T.C1120.NUM_VAR.WM,M,2026-09,3.1,"Inflation expectations, next 12 months"\nCES.M.Z18.ALL.T.C1120.NUM_VAR.WA,M,2026-09,5.3,"avg"\nCES.Q.Z18.ALL.T.C1120.NUM_VAR.WM,Q,2026-Q3,3.0,"quarterly"\n`;
  assert.deepEqual(parseEcb(csv), [{ series: "eu.ecb.infl_exp", period: "2026-09-01", value: 3.1 }]);
  assert.deepEqual(parseCsv('a,"b,c",d\n"x ""y""",2,3'), [["a", "b,c", "d"], ['x "y"', "2", "3"]]);
});

test("New York Fed workbook: named sheets, yyyymm rows, better-off balance", async () => {
  const p = await parseSce(new Uint8Array(readFileSync("tests/fixtures/sce-mini.xlsx")));
  const v = (id: string) => p.find((x) => x.series === id && x.period === "2026-10-01")?.value;
  assert.equal(v("us.sce.job_loss"), 13.94);
  assert.equal(v("us.sce.unemp_up"), 45.31);
  assert.equal(v("us.sce.better_off"), Math.round((20.1 + 4.1 - 8.3 - 27.3) * 10) / 10);
  assert.equal(p.filter((x) => x.series === "us.sce.job_loss").length, 2);
});

test("scores compare with the last ten years, respecting which way is better", () => {
  const s = SERIES.find((x) => x.id === "us.sce.job_loss")!; // lower is better
  const hist = Array.from({ length: 24 }, (_, i) => ({ period: `20${String(24 + Math.floor(i / 12)).padStart(2, "0")}-${String((i % 12) + 1).padStart(2, "0")}-01`, value: 10 + i * 0.1 }));
  const worst = readingFor(s, hist);
  assert.equal(worst.score, 0, "the highest job-loss fear in the window is the gloomiest");
  assert.equal(worst.change, "worse");
  const best = readingFor(s, [...hist, { period: "2026-01-01", value: 5 }]);
  assert.equal(best.score, 10);
  assert.equal(best.change, "better");
  assert.equal(readingFor(s, hist.slice(0, 5)).score, null, "too little history isn't scored");
  assert.equal(moodWord(1), "Very gloomy");
  const m = moods(new Map([["us.sce.job_loss", hist]]), ["US"]);
  const jobs = m.find((x) => x.theme === "jobs")!;
  assert.equal(jobs.score, 0);
  assert.match(forPrompt(m).find((x) => x.theme === "jobs")!.evidence[0], /Chance of losing their job.*12\.3%/);
});

test("poll reports: only listed pollsters, only on a theme; region from the headline", () => {
  assert.deepEqual(classifyReport("More U.S. Workers Fear Losing Their Jobs to Technology - Gallup News"),
    { title: "More U.S. Workers Fear Losing Their Jobs to Technology", publisher: "Gallup", region: "US", themes: ["jobs"] });
  assert.equal(classifyReport("Views of U.S. Crime Remain Most Positive in 25 Years - Gallup News"), null, "not on a theme");
  assert.equal(classifyReport("Inflation is soaring, says my blog - Random Blog"), null, "not a pollster");
  assert.equal(classifyReport("Europeans worry about the cost of living - Ipsos")?.region, "EU");
  assert.equal(classifyReport("Inflation concern rises as the biggest issue facing Britain - Ipsos")?.region, "World", "the UK isn't in the EU");
  assert.equal(classifyReport("G7 Economic Optimism Plunges to Great Recession Levels - Gallup News")?.region, "World");
  assert.equal(classifyReport("Americans want next Congress to focus on the cost of living - Ipsos")?.region, "US");
  assert.deepEqual(classifyReport("In the U.S. and around the world, inflation is high", "Pew Research Center")?.themes, ["prices"]);
});
