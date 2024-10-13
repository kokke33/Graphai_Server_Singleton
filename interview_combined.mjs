// interview_combined.mjs
import { spawn } from "child_process";
import stripAnsi from "strip-ansi";

// ANSIエスケープコードを削除する関数
function removeAnsiEscapeCodes(text) {
  return stripAnsi(text);
}

console.log("interview_combined.mjs が起動しました。");

let interviewProcessMap = new Map(); // セッションIDとプロセスのマッピング

// 親プロセスからメッセージを受け取る
process.on("message", (message) => {
  const { sessionId, command, namespace, message: userMessage } = message;
  console.log(`メッセージを受信しました: ${JSON.stringify(message)}`);

  if (command === "start_interview") {
    if (interviewProcessMap.has(sessionId)) {
      process.send({ sessionId, error: "既にインタビューが開始されています。" });
      return;
    }

    // GraphAIコマンドの設定（必要に応じてパスを変更）
    const graphaiCommand = "graphai";
    const yamlFileMap = {
      create: "./interview.yaml",
      answer: "./interview2.yaml",
      sechat: "./interview3.yaml",
    };
    const yamlFile = yamlFileMap[namespace];

    if (!yamlFile) {
      const errorMessage = `不明なネームスペース: ${namespace}`;
      console.error(errorMessage);
      process.send({ sessionId, error: errorMessage });
      return;
    }

    const args = [yamlFile];
    console.log(`graphaiコマンドを実行します。Command: ${graphaiCommand}, Args: ${args}`);

    const aiProcess = spawn(graphaiCommand, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    // データのバッファリング
    let buffer = "";

    // 「? あなた:」から「AI: 」までの文字を削除する正規表現
    const removePromptRegex = /\? あなた:[\s\S]*?★AI回答/g;

    aiProcess.stdout.on("data", (data) => {
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
          process.send({ sessionId, response: outputMessage });
          console.log(`親プロセスにメッセージを送信: ${outputMessage}`);
        }

        // バッファをクリア
        buffer = "";
      }
    });

    aiProcess.stderr.on("data", (data) => {
      const stderrMessage = removeAnsiEscapeCodes(data.toString()).trim();
      if (stderrMessage) {
        console.error(`stderr: ${stderrMessage}`);
        process.send({ sessionId, error: stderrMessage });
      }
    });

    aiProcess.on("exit", (code, signal) => {
      const exitMessage = `graphaiプロセスが終了しました。コード: ${code}, シグナル: ${signal}`;
      console.error(exitMessage);
      process.send({ sessionId, error: exitMessage });
      interviewProcessMap.delete(sessionId);
    });

    // プロセスをマップに保存
    interviewProcessMap.set(sessionId, aiProcess);
    process.send({ sessionId, response: "インタビューが開始されました。" });
  } else if (command === "user_input") {
    const aiProcess = interviewProcessMap.get(sessionId);
    if (aiProcess && aiProcess.stdin.writable) {
      console.log(`AIプロセスにユーザー入力を送信します。Session ID: ${sessionId}, Message: ${userMessage}`);
      aiProcess.stdin.write(`${userMessage}\n`);
    } else {
      const errorMessage = "インタビュープロセスが利用できません。";
      console.error(errorMessage);
      process.send({ sessionId, error: errorMessage });
    }
  } else if (command === "end_interview") {
    const aiProcess = interviewProcessMap.get(sessionId);
    if (aiProcess) {
      aiProcess.kill();
      interviewProcessMap.delete(sessionId);
      process.send({ sessionId, response: "インタビューが終了しました。" });
    }
  } else {
    console.log("不明なコマンドを受信:", message);
  }
});

// 未処理の例外をキャッチ
process.on("uncaughtException", (err) => {
  console.error(`子プロセスで未処理の例外が発生: ${err.message}`);
});

// 終了イベントをハンドリング
process.on("exit", (code) => {
  console.log(`子プロセスが終了しました。コード: ${code}`);
});

// 準備完了を通知
process.send({ status: "ready" });
