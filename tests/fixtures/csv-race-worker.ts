import { csvFixture } from "../csv-test-helpers.js";
const fixture = csvFixture(process.argv[2], false);
process.send?.("ready");
process.once("message", () => {
  try {
    const result = fixture.submit();
    process.send?.({ batch: result.receipt.batch_id, added: result.added_this_request });
  } finally {
    fixture.db.close();
    process.disconnect?.();
  }
});
