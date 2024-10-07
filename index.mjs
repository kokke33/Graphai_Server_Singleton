// index.mjs
import express from "express";
import { createServer } from "http";
import { join, dirname } from "path";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import ProcessPool from "./processPool.mjs"; // プロセスプールをインポート

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const SOCKET_IO_PORT = 8085;

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ログ関数の定義
function log(message, level = "info") {
  if (console[level]) {
    console[level](`${level.toUpperCase()}: ${message}`);
  } else {
    console.log(`${level.toUpperCase()}: ${message}`);
  }
}

// タイムアウト設定（ミリ秒）
const INACTIVITY_LIMIT = 600000; // 10分

// プロセスプールの初期化
const poolSize = 50; // プール内のプロセス数（適宜調整してください）
const scriptPath = join(__dirname, "interview_combined.mjs");
const processPool = new ProcessPool(poolSize, scriptPath);

/**
 * ネームスペースごとに処理を設定する関数
 * @param {string} namespace - ネームスペース名
 */
function setupNamespace(namespace) {
  const ns = io.of(`/${namespace}`);

  ns.on("connection", (socket) => {
    // クエリからログインIDを取得
    const { loginID } = socket.handshake.query;
    if (!loginID) {
      log(`未認証の接続が試みられました [${namespace}]: ${socket.id}`, "warn");
      socket.emit("interview_result", "認証に失敗しました。ログインしてください。");
      socket.disconnect(true);
      return;
    }

    log(
      `新しいユーザーが接続しました [${namespace}]: ${socket.id} (ログインID: ${loginID})`
    );

    let inactivityTimeout = null;

    // 非アクティブタイムアウトをリセットする関数
    const resetInactivityTimeout = () => {
      if (inactivityTimeout) {
        clearTimeout(inactivityTimeout);
      }
      inactivityTimeout = setTimeout(() => {
        log(
          `[ユーザー ${socket.id} (ログインID: ${loginID})] 非アクティブのため接続を切断します [${namespace}]`
        );
        socket.emit(
          "interview_result",
          "セッションがタイムアウトしました。接続を終了します。"
        );
        socket.disconnect(true);
      }, INACTIVITY_LIMIT);
    };

    // 接続時にタイマーを開始
    resetInactivityTimeout();

    socket.on("start_interview", async () => {
      resetInactivityTimeout();
      log(
        `[ユーザー ${socket.id} (ログインID: ${loginID})] インタビュー開始リクエストを受信しました [${namespace}]`
      );

      if (socket.interviewProcess) {
        log(
          `[ユーザー ${socket.id} (ログインID: ${loginID})] 既にインタビューが開始されています [${namespace}]`,
          "warn"
        );
        socket.emit("interview_result", "既にインタビューが開始されています。");
        return;
      }

      try {
        // プロセスプールからプロセスを取得
        const interviewProcess = await processPool.acquire();
        log(`プロセスプールから子プロセスを取得しました。Process PID: ${interviewProcess.pid}`);

        // 子プロセスにネームスペースとメッセージを送信
        const initMessage = { namespace, message: "start_interview" };
        log(`子プロセスにメッセージを送信します: ${JSON.stringify(initMessage)}`);
        interviewProcess.send(initMessage);

        // 子プロセスからのメッセージを処理
        const messageHandler = (response) => {
          log(`親プロセスが子プロセスからのメッセージを受信: ${JSON.stringify(response)}`);

          if (response.status === "ready") {
            // 子プロセスの準備完了
            log(`[ユーザー ${socket.id} (ログインID: ${loginID})] 子プロセスの準備ができました [${namespace}]`);
          } else if (response.response) {
            // クライアントにメッセージを送信
            log(`[ユーザー ${socket.id} (ログインID: ${loginID})] 子プロセスからのメッセージ: ${response.response}`);
            socket.emit("interview_result", response.response.trim());
          }
        };

        // エラーハンドリング
        const errorHandler = (err) => {
          log(
            `[ユーザー ${socket.id} (ログインID: ${loginID})] 子プロセスエラー: ${err.message} [${namespace}]`,
            "error"
          );
          socket.emit("interview_result", `エラー: 子プロセスエラー: ${err.message}`);
          socket.disconnect(true);
        };

        // 子プロセスの終了時の処理
        const exitHandler = (code, signal) => {
          log(
            `[ユーザー ${socket.id} (ログインID: ${loginID})] 子プロセスが終了しました。コード: ${code}, シグナル: ${signal} [${namespace}]`,
            "warn"
          );
          socket.emit("interview_result", "インタビュープロセスが終了しました。");
          socket.disconnect(true);
        };

        // イベントハンドラを登録
        interviewProcess.on("message", messageHandler);
        interviewProcess.on("error", errorHandler);
        interviewProcess.on("exit", exitHandler);

        // ソケットにプロセスとハンドラを保存（切断時に使用）
        socket.interviewProcess = interviewProcess;
        socket.messageHandler = messageHandler;
        socket.errorHandler = errorHandler;
        socket.exitHandler = exitHandler;
      } catch (error) {
        // エラーハンドリング
        log(
          `[ユーザー ${socket.id} (ログインID: ${loginID})] エラーが発生しました: ${error.message}`,
          "error"
        );
        socket.emit("interview_result", `エラー: ${error.message}`);
      }
    });

    socket.on("user_input", (message) => {
      resetInactivityTimeout();
      log(
        `[ユーザー ${socket.id} (ログインID: ${loginID})] メッセージ受信: ${message} [${namespace}]`
      );

      // ユーザー入力の検証とサニタイズ
      if (typeof message !== "string" || message.trim() === "") {
        log(
          `[ユーザー ${socket.id} (ログインID: ${loginID})] 無効な入力が検出されました [${namespace}]`,
          "warn"
        );
        return;
      }

      if (socket.interviewProcess) {
        // 子プロセスが終了していないか確認
        if (socket.interviewProcess.connected) {
          // メッセージを送信
          socket.interviewProcess.send({ message });
          log(`子プロセスにメッセージを送信しました: ${message}`);
        } else {
          log(
            `[ユーザー ${socket.id} (ログインID: ${loginID})] 子プロセスとの接続が切れています [${namespace}]`,
            "error"
          );
          socket.emit("interview_result", "エラー: インタビュープロセスとの通信ができません。");
        }
      } else {
        log(
          `[ユーザー ${socket.id} (ログインID: ${loginID})] インタビュープロセスが利用できません [${namespace}]`,
          "error"
        );
        socket.emit(
          "interview_result",
          "インタビュープロセスが開始されていません。"
        );
      }
    });

    socket.on("disconnect", () => {
      log(
        `[ユーザー ${socket.id} (ログインID: ${loginID})] ユーザーが切断しました [${namespace}]`
      );

      if (socket.interviewProcess) {
        // イベントハンドラを解除
        socket.interviewProcess.off("message", socket.messageHandler);
        socket.interviewProcess.off("error", socket.errorHandler);
        socket.interviewProcess.off("exit", socket.exitHandler);

        // 子プロセスを解放
        processPool.release(socket.interviewProcess);

        // 参照を削除
        socket.interviewProcess = null;
        socket.messageHandler = null;
        socket.errorHandler = null;
        socket.exitHandler = null;
      }
      if (inactivityTimeout) {
        clearTimeout(inactivityTimeout);
      }
    });
  });
}

// 各ネームスペースの設定を簡略化
const namespaces = ["create", "answer", "sechat"];
namespaces.forEach(setupNamespace);

// エラーハンドリングミドルウェア
app.use((err, req, res, __next) => {
  log(`サーバーエラー: ${err.stack}`, "error");
  res.status(500).json({});
});

server.listen(SOCKET_IO_PORT, () => {
  console.log(`サーバーが起動し、ポート${SOCKET_IO_PORT}でリスニングしています`);
});
