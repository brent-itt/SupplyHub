import assert from "node:assert/strict";
import test from "node:test";
import { deliverGmailReminder, GmailDeliveryError } from "../src/lib/gmail-reminder";
import type { PreparedReminder } from "../src/lib/vip-reminder";

const reminder: PreparedReminder = {
  id: "a3376e2c-6bce-427b-904b-76b20163c612", recipient: "student@example.test", accepted_at: null,
  payload: { from: "SupplyHub <office@gmail.com>", to: ["student@example.test"], subject: "Collection reminder", text: "7 remaining", reply_to: "office@example.test" },
};

test("Gmail sends the saved message with a traceable ID and reply address", async () => {
  const id = await deliverGmailReminder(reminder, async mail => {
    assert.equal(mail.from, reminder.payload.from);
    assert.deepEqual(mail.to, reminder.payload.to);
    assert.equal(mail.text, "7 remaining");
    assert.equal(mail.replyTo, "office@example.test");
    assert.equal(mail.messageId, `<vip-reminder.${reminder.id}@supplyhub.local>`);
    return { messageId: mail.messageId!, accepted: [reminder.recipient] };
  });
  assert.ok(id.includes(reminder.id));
});

test("only definite Gmail failures permit a retry; raw SMTP errors stay private", async () => {
  for (const [failure, retryable] of [
    [{ code: "EAUTH", message: "sensitive provider text" }, true],
    [{ responseCode: 550 }, true],
    [{ responseCode: 421 }, true],
    [{ code: "ETIMEDOUT" }, false],
    [{ code: "ECONNRESET" }, false],
  ] as const) {
    await assert.rejects(deliverGmailReminder(reminder, async () => { throw failure; }), error => {
      assert.ok(error instanceof GmailDeliveryError);
      assert.equal(error.retryable, retryable);
      assert.doesNotMatch(error.message, /sensitive/);
      return true;
    });
  }
  await assert.rejects(deliverGmailReminder(reminder, async () => ({ messageId: "id", accepted: [] })), /rejected/);
});
