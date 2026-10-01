import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseCsv, fitLinear, invertCalibration } from "../lib/dataLab";
test("CSV handles quoted fields and rejects ambiguous data", () => {
  assert.equal(parseCsv('x,y,note\n1,2,"a,b"\n2,3,"line\ntext"').rows[0][2], "a,b");
  assert.throws(() => parseCsv('x,y\n1,2\n3'));
  assert.throws(() => parseCsv('x,y\n1,"unterminated'));
});
test("linear calibration and extrapolation are deterministic", () => {
  const fit = fitLinear([[1, .06], [2, .11], [3, .16], [4, .21], [5, .26]]);
  assert.ok(Math.abs(fit.slope - .05) < 1e-10); assert.ok(Math.abs(fit.intercept - .01) < 1e-10);
  assert.ok(Math.abs(invertCalibration(fit, .26, 2).corrected - 10) < 1e-8);
  assert.equal(invertCalibration(fit, .8).extrapolated, true);
  assert.throws(() => fitLinear([[1, 2], [1, 3], [1, 4]]));
  assert.throws(() => fitLinear([[1, 2], [2, NaN], [3, 4]]));
});
