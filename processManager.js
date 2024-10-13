// processManager.js
import { fork } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";

const __dirname = dirname(fileURLToPath(import.meta.url));

class SingletonAI {
  constructor(scriptPath) {
    this.scriptPath = scriptPath;
    this.process = this.createProcess();
    this.callbacks = new Map(); // セッションIDとコールバックのマッピング
    this.currentLoad = 0; // 現在の負荷（アクティブなセッション数）
  }

  createProcess() {
    const proc = fork(this.scriptPath, [], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      execArgv: ["--experimental-modules"],
    });
    console.log(`シングルトンAIプロセスを作成しました。PID: ${proc.pid}`);

    proc.on("message", this.handleMessage.bind(this));

    proc.on("exit", (code, signal) => {
      console.error(
        `シングルトンAIプロセスが終了しました。コード: ${code}, シグナル: ${signal}`,
      );
      // プロセスが終了した場合、再起動
      setTimeout(() => {
        console.log("シングルトンAIプロセスを再起動します...");
        this.process = this.createProcess();
      }, 5000); // 5秒後に再起動
    });

    proc.on("error", (error) => {
      console.error(
        `シングルトンAIプロセスでエラーが発生しました: ${error.message}`,
      );
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
        console.log(`セッションID ${sessionId} のエラー: ${error}`);
      } else {
        callback.resolve(response);
        console.log(`セッションID ${sessionId} のレスポンス: ${response}`);
      }
      this.callbacks.delete(sessionId);
      this.currentLoad--;
    } else {
      console.warn(`未登録のセッションID: ${sessionId}`);
    }
  }

  sendMessage(sessionId, message) {
    return new Promise((resolve, reject) => {
      // タイムアウト処理（例：30秒）
      const timeout = setTimeout(() => {
        if (this.callbacks.has(sessionId)) {
          this.callbacks.delete(sessionId);
          reject(new Error("AIプロセスからの応答がタイムアウトしました。"));
          this.currentLoad--;
          console.warn(
            `セッションID ${sessionId} のタイムアウトが発生しました。`,
          );
        }
      }, 30000);

      // Promiseが解決または拒否されたときにタイムアウトをクリア
      const wrappedResolve = (value) => {
        clearTimeout(timeout);
        resolve(value);
        this.currentLoad--;
        console.log(
          `セッションID ${sessionId} のコールバックが解決されました。`,
        );
      };

      const wrappedReject = (reason) => {
        clearTimeout(timeout);
        reject(reason);
        this.currentLoad--;
        console.log(
          `セッションID ${sessionId} のコールバックが拒否されました。理由: ${reason}`,
        );
      };

      // コールバックを1回だけ設定
      this.callbacks.set(sessionId, {
        resolve: wrappedResolve,
        reject: wrappedReject,
      });
      console.log(`セッションID ${sessionId} のコールバックを登録しました。`);
      this.process.send({ sessionId, ...message });
      this.currentLoad++;
      console.log(`セッションID ${sessionId} にメッセージを送信しました。`);
    });
  }

  shutdown() {
    if (this.process) {
      this.process.kill();
      this.process = null;
      console.log("シングルトンAIプロセスを終了しました。");
    }
  }
}

class ProcessManager {
  constructor(scriptPath, poolSize = 3) {
    this.scriptPath = scriptPath;
    this.poolSize = poolSize;
    this.processes = [];

    for (let i = 0; i < this.poolSize; i++) {
      const ai = new SingletonAI(this.scriptPath);
      this.processes.push(ai);
    }
  }

  // 最も負荷の低いプロセスを取得
  getLeastLoadedProcess() {
    return this.processes.reduce((prev, current) => {
      return prev.currentLoad < current.currentLoad ? prev : current;
    }, this.processes[0]);
  }

  // メッセージを送信
  sendMessage(message) {
    const aiProcess = this.getLeastLoadedProcess();
    return aiProcess.sendMessage(message.sessionId, message.message);
  }

  // システム終了時に全プロセスをシャットダウン
  shutdownAll() {
    this.processes.forEach((ai) => ai.shutdown());
  }
}

// プロセスマネージャーのインスタンスを作成
const scriptPath = join(__dirname, "interview_combined.mjs");
const poolSize = 30; // プロセスプールのサイズ（必要に応じて調整）
const processManager = new ProcessManager(scriptPath, poolSize);

// エクスポート
export default processManager;
