// interview_combined.mjs
import { spawn } from "child_process";
import stripAnsi from "strip-ansi";

// ANSIエスケープコードを削除する関数
function removeAnsiEscapeCodes(text) {
  return stripAnsi(text);
}

// 子プロセス起動時のログ
console.log("interview_combined.mjs が起動しました。");

let interviewProcess;

// 親プロセスからネームスペース情報を受け取る
let namespace = null;

process.on("message", (message) => {
  console.log(`子プロセスでメッセージを受信: ${JSON.stringify(message)}`);

  if (message.namespace) {
    namespace = message.namespace;
    console.log(`ネームスペースを設定: ${namespace}`);
  }

  if (message.message === "start_interview") {
    console.log(`インタビューを開始します。ネームスペース: ${namespace}`);

    // 子プロセスでインタビューを開始
    const graphaiCommand = "graphai"; // 必要に応じて絶対パスに変更

    // ネームスペースに応じて適切なYAMLファイルを選択
    const yamlFileMap = {
      create: "./interview.yaml",
      answer: "./interview2.yaml",
      sechat: "./interview3.yaml",
    };

    const yamlFile = yamlFileMap[namespace];

    if (!yamlFile) {
      const errorMessage = `不明なネームスペース: ${namespace}`;
      console.error(errorMessage);
      process.send({ response: errorMessage });
      return;
    }

    const args = [yamlFile];

    console.log(`graphaiコマンドを実行します。Command: ${graphaiCommand}, Args: ${args}`);

    interviewProcess = spawn(graphaiCommand, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env, // 親プロセスの環境変数を継承
    });

    // エラーイベントのハンドリング
    interviewProcess.on("error", (error) => {
      const errorMessage = `子プロセスエラー: ${error.message}`;
      console.error(errorMessage);
      process.send({ response: errorMessage });
    });

    // プロセスが終了した場合のハンドリング
    interviewProcess.on("exit", (code, signal) => {
      const exitMessage = `graphaiプロセスが終了しました。コード: ${code}, シグナル: ${signal}`;
      console.error(exitMessage);
      process.send({ response: exitMessage });
    });

    // データのバッファリングと組み立て
    let buffer = "";

    // 「? あなた:」から「AI: 」までの文字を削除する正規表現
    const removePromptRegex = /\? あなた:[\s\S]*?★AI回答/g;

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
          console.log(`親プロセスにメッセージを送信: ${outputMessage}`);
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

  } else if (message.message) {
    // ユーザー入力を子プロセスに送信
    if (interviewProcess && interviewProcess.stdin.writable) {
      console.log("子プロセスに書き込み:", message.message);
      interviewProcess.stdin.write(`${message.message}\n`);
    } else {
      const errorMessage = "インタビュープロセスが利用できません。";
      console.error(errorMessage);
      process.send({ response: errorMessage });
    }
  } else {
    console.log("不明なメッセージを受信:", message);
  }
});

// 子プロセスの未処理の例外をキャッチ
process.on("uncaughtException", (err) => {
  console.error(`子プロセスで未処理の例外が発生: ${err.message}`);
});

// 子プロセスの終了イベントをハンドリング
process.on("exit", (code) => {
  console.log(`子プロセスが終了しました。コード: ${code}`);
});

// 親プロセスに準備完了を通知
process.send({ status: "ready" });
