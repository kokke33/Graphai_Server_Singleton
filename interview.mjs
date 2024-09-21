import { spawn } from "child_process";
import stripAnsi from "strip-ansi";

// ANSIエスケープコードを削除する関数
function removeAnsiEscapeCodes(text) {
  return stripAnsi(text);
}

let interviewProcess;

// 親プロセスに準備完了を通知
process.send({ status: "ready" });

let buffer = "";

// 「? あなた:」から「AI: 」までの文字を削除する正規表現
const removePromptRegex = /\? あなた:[\s\S]*?★AI回答/g;

process.on("message", (message) => {
  if (message.message === "start_interview") {
    console.log("インタビューを開始します。");

    // 子プロセスでインタビューを開始
    const graphaiCommand = "graphai"; // 必要に応じて絶対パスに変更
    const args = ["./interview.yaml"];

    interviewProcess = spawn(graphaiCommand, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb" },
    });

    // エラーイベントのハンドリング
    interviewProcess.on("error", (error) => {
      const errorMessage = `子プロセスエラー: ${error.message}`;
      console.error(errorMessage);
      process.send({ response: errorMessage });
    });

    // データのバッファリングと組み立て
    interviewProcess.stdout.on("data", (data) => {
      buffer += data.toString();

      // ANSIエスケープコードを削除
      let cleanBuffer = removeAnsiEscapeCodes(buffer);

      // 「AI: 」が含まれているか確認
      if (cleanBuffer.includes("AI: ")) {
        // 「? あなた:」から「AI: 」までの文字を削除
        let modifiedBuffer = cleanBuffer.replace(removePromptRegex, "");

        let outputMessage = modifiedBuffer.trim();

        if (outputMessage) {
          // 完全なメッセージを親プロセスに送信
          process.send({ response: outputMessage });
        }

        // バッファをクリア
        buffer = "";
      }
    });

    // 標準エラーのデータを親プロセスに送信
    interviewProcess.stderr.on("data", (data) => {
      const stderrMessage = removeAnsiEscapeCodes(data.toString()).trim();
      if (stderrMessage) {
        console.error(`stderr: ${stderrMessage}`);
        process.send({ response: stderrMessage });
      }
    });

    // プロセス終了のイベントを親プロセスに送信
    interviewProcess.on("close", (code) => {
      const closeMessage = `インタビュープロセスが終了コード ${code} で終了しました`;
      console.log(closeMessage);
      process.send({ response: closeMessage });
    });
  } else if (message.message) {
    // ユーザー入力を子プロセスに送信
    if (interviewProcess && interviewProcess.stdin.writable) {
      console.log("子プロセスに書き込み:", message.message);
      interviewProcess.stdin.write(`${message.message}\n`);
    } else {
      console.error("子プロセスのstdinに書き込めませんでした。");
    }
  } else {
    console.log("不明なメッセージを受信:", message);
  }
});

// 子プロセスのエラーハンドリング
process.on("error", (error) => {
  const errorMessage = `プロセスエラー: ${error.message}`;
  console.error(errorMessage);
  process.send({ response: errorMessage });
});
