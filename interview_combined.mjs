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
      console.log(`既にインタビューが開始されています。Session ID: ${sessionId}`);
      return;
    }

    // GraphAIコマンドの設定（必要に応じてパスを変更）
    const graphaiCommand = "graphai"; // フルパスを指定することを推奨
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

    let aiProcess;
    try {
      aiProcess = spawn(graphaiCommand, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
      console.log(`graphaiプロセスを起動しました。PID: ${aiProcess.pid}`);
    } catch (err) {
      const errorMessage = `graphaiの起動に失敗しました: ${err.message}`;
      console.error(errorMessage);
      process.send({ sessionId, error: errorMessage });
      return;
    }

    // エラー発生時のハンドリング
    aiProcess.on("error", (err) => {
      const errorMessage = `graphaiプロセスでエラーが発生しました: ${err.message}`;
      console.error(errorMessage);
      process.send({ sessionId, error: errorMessage });
    });

    // データのバッファリング
    let buffer = "";

    // 「? あなた:」から「AI: 」までの文字を削除する正規表現
    const removePromptRegex = /\? あなた:[\s\S]*?★AI回答/g;

    aiProcess.stdout.on("data", (data) => {
      buffer += data.toString();
      console.log(`graphai stdout: ${data.toString()}`); // 追加

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
      console.error(`graphai stderr: ${stderrMessage}`); // 追加
      if (stderrMessage) {
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
    console.log(`インタビュー開始が完了しました。Session ID: ${sessionId}`);
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
      console.log(`インタビューが終了しました。Session ID: ${sessionId}`);
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
