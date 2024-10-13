// index.mjs
import express from "express";
import { createServer } from "http";
import { join, dirname } from "path";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import processManager from "./processManager.js"; // プロセスマネージャーをインポート
import { v4 as uuidv4 } from "uuid"; // 一意のセッションID生成用

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

      if (socket.interviewSessionId) {
        log(
          `[ユーザー ${socket.id} (ログインID: ${loginID})] 既にインタビューが開始されています [${namespace}]`,
          "warn"
        );
        socket.emit("interview_result", "既にインタビューが開始されています。");
        return;
      }

      try {
        // 一意のセッションIDを生成
        const sessionId = uuidv4();
        socket.interviewSessionId = sessionId;

        // プロセスマネージャーにメッセージを送信
        log(`プロセスマネージャーにインタビュー開始メッセージを送信します。Session ID: ${sessionId}`);
        const response = await processManager.sendMessage({
          sessionId,
          message: { command: "start_interview", namespace },
        });

        log(`AIプロセスからのレスポンスを受信しました。Session ID: ${sessionId}`);
        socket.emit("interview_result", response);
      } catch (error) {
        log(
          `[ユーザー ${socket.id} (ログインID: ${loginID})] エラーが発生しました: ${error.message}`,
          "error"
        );
        socket.emit("interview_result", `エラー: ${error.message}`);
      }
    });

    socket.on("user_input", async (message) => {
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

      if (socket.interviewSessionId) {
        try {
          const sessionId = socket.interviewSessionId;
          log(`プロセスマネージャーにユーザー入力を送信します。Session ID: ${sessionId}, Message: ${message}`);
          const response = await processManager.sendMessage({
            sessionId,
            message: { command: "user_input", message },
          });

          log(`AIプロセスからのレスポンスを受信しました。Session ID: ${sessionId}`);
          socket.emit("interview_result", response);
        } catch (error) {
          log(
            `[ユーザー ${socket.id} (ログインID: ${loginID})] エラーが発生しました: ${error.message}`,
            "error"
          );
          socket.emit("interview_result", `エラー: ${error.message}`);
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

      if (socket.interviewSessionId) {
        // プロセスマネージャーにセッション終了を通知
        processManager
          .sendMessage({
            sessionId: socket.interviewSessionId,
            message: { command: "end_interview" },
          })
          .catch((err) => log(`セッション終了メッセージ送信エラー: ${err.message}`, "error"));
        socket.interviewSessionId = null;
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

// システム終了時にプロセスマネージャーをシャットダウン
process.on("SIGINT", () => {
  console.log("プロセス終了信号を受信しました。シャットダウンします...");
  processManager.shutdownAll();
  process.exit();
});
