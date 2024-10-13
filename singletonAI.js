// singletonAI.js
import { fork } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// 現在のディレクトリを取得
const __dirname = dirname(fileURLToPath(import.meta.url));

class SingletonAI {
  constructor(scriptPath) {
    this.scriptPath = scriptPath;
    this.process = this.createProcess();
    this.callbacks = new Map(); // セッションIDとコールバックのマッピング
  }

  createProcess() {
    const proc = fork(this.scriptPath, [], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      execArgv: ["--experimental-modules"],
    });
    console.log(`シングルトンAIプロセスを作成しました。PID: ${proc.pid}`);

    proc.on("message", this.handleMessage.bind(this));

    proc.on("exit", (code, signal) => {
      console.error(`シングルトンAIプロセスが終了しました。コード: ${code}, シグナル: ${signal}`);
      // 必要に応じて再起動ロジックを追加
      // 再起動を試みる場合は以下のコメントを外してください
      // this.process = this.createProcess();
    });

    proc.on("error", (error) => {
      console.error(`シングルトンAIプロセスでエラーが発生しました: ${error.message}`);
      // 必要に応じてエラーハンドリングを追加
    });

    return proc;
  }

  handleMessage(message) {
    const { sessionId, response, error, status } = message;

    if (status === "ready") {
      console.log("AIプロセスが準備完了しました。");
      return;
    }

    if (!sessionId) {
      console.warn("セッションIDが含まれていないメッセージを受信しました。");
      return;
    }

    if (this.callbacks.has(sessionId)) {
      const callback = this.callbacks.get(sessionId);
      if (error) {
        callback.reject(error);
      } else {
        callback.resolve(response);
      }
      this.callbacks.delete(sessionId);
    } else {
      console.warn(`未登録のセッションID: ${sessionId}`);
    }
  }

  sendMessage(sessionId, message) {
    return new Promise((resolve, reject) => {
      this.callbacks.set(sessionId, { resolve, reject });
      this.process.send({ sessionId, ...message });

      // タイムアウト処理（例：5分）
      const timeout = setTimeout(() => {
        if (this.callbacks.has(sessionId)) {
          this.callbacks.delete(sessionId);
          reject(new Error("AIプロセスからの応答がタイムアウトしました。"));
        }
      }, 350000);

      // Promiseが解決または拒否されたときにタイムアウトをクリア
      const originalResolve = resolve;
      const originalReject = reject;

      resolve = (value) => {
        clearTimeout(timeout);
        originalResolve(value);
      };

      reject = (reason) => {
        clearTimeout(timeout);
        originalReject(reason);
      };

      this.callbacks.set(sessionId, { resolve, reject });
    });
  }

  // プロセスを終了させるメソッド（必要に応じて）
  shutdown() {
    if (this.process) {
      this.process.kill();
      this.process = null;
      console.log("シングルトンAIプロセスを終了しました。");
    }
  }
}

// シングルトンAIプロセスのスクリプトパスを設定
const scriptPath = join(__dirname, "interview_combined.mjs");

// シングルトンAIインスタンスを作成
const singletonAI = new SingletonAI(scriptPath);

// エクスポート
export default singletonAI;
