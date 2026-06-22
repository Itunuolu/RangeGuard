import { keeperReceiptPath, readKeeperExecutionReceipts, syncKeeperReceiptToDatabase } from "@/lib/autonomy/receiptStore";

async function main() {
  const receipts = readKeeperExecutionReceipts(1_000);
  const results = {
    receiptPath: keeperReceiptPath(),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    receiptsFound: receipts.length,
    persisted: 0,
    skipped: 0,
    failed: 0,
  };

  console.log(`[RangeGuard Receipts] reading ${results.receiptPath}`);

  if (receipts.length === 0) {
    console.log("[RangeGuard Receipts] no keeper receipts found.");
    return;
  }

  for (const receipt of receipts) {
    try {
      const result = await syncKeeperReceiptToDatabase(receipt);

      if (result.persisted) {
        results.persisted += 1;
      } else {
        results.skipped += 1;
      }

      console.log(
        [
          `[RangeGuard Receipts] ${receipt.actionId || "receipt"}`,
          `status=${receipt.status}`,
          `db=${result.persisted ? "persisted" : "skipped"}`,
          `reason=${result.reason}`,
        ].join(" "),
      );
    } catch (error) {
      results.failed += 1;
      console.error(
        `[RangeGuard Receipts] failed ${receipt.actionId || "receipt"}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  console.log(
    `[RangeGuard Receipts] summary found=${results.receiptsFound} persisted=${results.persisted} skipped=${results.skipped} failed=${results.failed}`,
  );

  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[RangeGuard Receipts] replay failed");
  console.error(error);
  process.exitCode = 1;
});
