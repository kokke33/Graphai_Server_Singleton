import { fork } from "child_process";
import express from "express";
import { createServer } from "http";
import { join, dirname } from "path";
import { Server } from "socket.io";
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const SOCKET_IO_PORT = 8085;

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    // origin: ["https://9213dd84-a906-444f-84d0-26746298442c-00-w2hmmzt71inr.pike.replit.dev:5173"],
    origin: ["https://graphai2.web.app"],
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
const INACTIVITY_LIMIT = 600000; // 10:分

/**
 * ネームスペースごとに処理を設定する関数
 * @param {string} namespace - ネームスペース名
 * @param {string} script - フォークするスクリプト名
 */
function setupNamespace(namespace, script) {
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

    log(`新しいユーザーが接続しました [${namespace}]: ${socket.id} (ログインID: ${loginID})`);

    let interviewProcess = null;
    let inactivityTimeout = null;

    // インタビュー完了フラグ
    let interviewCompleted = false;

    // 非アクティブタイムアウトをリセットする関数
    const resetInactivityTimeout = () => {
      if (inactivityTimeout) {
        clearTimeout(inactivityTimeout);
      }
      inactivityTimeout = setTimeout(() => {
        log(`[ユーザー ${socket.id} (ログインID: ${loginID})] 非アクティブのため接続を切断します [${namespace}]`);
        socket.emit("interview_result", "セッションがタイムアウトしました。接続を終了します。");
        socket.disconnect(true);
      }, INACTIVITY_LIMIT);
    };

    // 接続時にタイマーを開始
    resetInactivityTimeout();

    socket.on("start_interview", async () => {
      resetInactivityTimeout();
      log(`[ユーザー ${socket.id} (ログインID: ${loginID})] インタビュー開始リクエストを受信しました [${namespace}]`);

      if (interviewProcess) {
        log(`[ユーザー ${socket.id} (ログインID: ${loginID})] 既にインタビューが開始されています [${namespace}]`, "warn");
        socket.emit("interview_result", "既にインタビューが開始されています。");
        return;
      }

      try {
        const scriptPath = join(__dirname, script);

        log(
          `[ユーザー ${socket.id} (ログインID: ${loginID})] スクリプトでインタビュープロセスを開始します: ${scriptPath} [${namespace}]`,
        );
        interviewProcess = fork(scriptPath, [], {
          stdio: ["pipe", "pipe", "pipe", "ipc"],
          execArgv: ["--experimental-modules"],
        });

        if (!interviewProcess) {
          log(
            `[ユーザー ${socket.id} (ログインID: ${loginID})] インタビュープロセスの起動に失敗しました [${namespace}]`,
            "error",
          );
          socket.emit(
            "interview_result",
            "エラー: インタビュープロセスの起動に失敗しました",
          );
          return;
        }

        // エラーハンドリング
        interviewProcess.on("error", (err) => {
          log(
            `[ユーザー ${socket.id} (ログインID: ${loginID})] 子プロセスの起動に失敗しました: ${err.message} [${namespace}]`,
            "error",
          );
          socket.emit(
            "interview_result",
            `エラー: 子プロセスの起動に失敗しました: ${err.message}`,
          );
          // 接続を切断
          socket.disconnect(true);
        });

        // 子プロセスからのメッセージを処理
        interviewProcess.on("message", (response) => {
          if (response.status === "ready") {
            log(`[ユーザー ${socket.id} (ログインID: ${loginID})] 子プロセスの準備ができました [${namespace}]`);
            // 子プロセスに開始メッセージを送信
            interviewProcess.send({ message: "start_interview" });
          } else if (response.status === "completed") {
            // インタビュー完了のメッセージ
            log(
              `[ユーザー ${socket.id} (ログインID: ${loginID})] インタビューが完了しました: ${JSON.stringify(response)} [${namespace}]`,
            );
            socket.emit("interview_result", "インタビューが完了しました。接続を終了します。");
            interviewCompleted = true;
            socket.disconnect(true); // 接続を切断
          } else if (response.response) {
            // 子プロセスからの通常のメッセージ
            log(
              `[ユーザー ${socket.id} (ログインID: ${loginID})] メッセージ受信: ${JSON.stringify(response)} [${namespace}]`,
            );

            const messageToSend = response.response.trim();
            if (messageToSend !== "") {
              socket.emit("interview_result", messageToSend);
            }
          } else {
            log(
              `[ユーザー ${socket.id} (ログインID: ${loginID})] 子プロセスからの不明なメッセージ: ${JSON.stringify(response)} [${namespace}]`,
              "warn",
            );
          }
        });

        // 子プロセスの終了を処理
        interviewProcess.on("exit", (code, signal) => {
          log(
            `[ユーザー ${socket.id} (ログインID: ${loginID})] インタビュープロセスがコード${code}とシグナル${signal}で終了しました [${namespace}]`,
          );
          if (!interviewCompleted) {
            socket.emit(
              "interview_result",
              `インタビュープロセスが予期せず終了しました。`,
            );
            socket.disconnect(true);
          }
        });
      } catch (error) {
        log(`[ユーザー ${socket.id} (ログインID: ${loginID})] 実行中にエラーが発生しました:`, "error");
        if (error instanceof Error) {
          log(
            `[ユーザー ${socket.id} (ログインID: ${loginID})] エラーメッセージ: ${error.message} [${namespace}]`,
            "error",
          );
          log(
            `[ユーザー ${socket.id} (ログインID: ${loginID})] スタックトレース: ${error.stack} [${namespace}]`,
            "error",
          );
          socket.emit("interview_result", `エラー: ${error.message}`);
        } else {
          log(`[ユーザー ${socket.id} (ログインID: ${loginID})] 不明なエラー: ${String(error)} [${namespace}]`, "error");
          socket.emit("interview_result", "不明なエラーが発生しました");
        }
        log(`[ユーザー ${socket.id} (ログインID: ${loginID})] 現在のPATH: ${process.env.PATH}`, "info");
        socket.disconnect(true);
      }
    });

    socket.on("user_input", (message) => {
      resetInactivityTimeout();
      log(`[ユーザー ${socket.id} (ログインID: ${loginID})] メッセージ受信: ${message} [${namespace}]`);

      // ユーザー入力の検証とサニタイズ
      if (typeof message !== "string" || message.trim() === "") {
        log(`[ユーザー ${socket.id} (ログインID: ${loginID})] 無効な入力が検出されました [${namespace}]`, "warn");
        return;
      }

      if (interviewProcess) {
        log(
          `[ユーザー ${socket.id} (ログインID: ${loginID})] インタビュープロセスにメッセージ"${message}"を書き込みます [${namespace}]`,
        );
        interviewProcess.send({ message });
      } else {
        log(
          `[ユーザー ${socket.id} (ログインID: ${loginID})] インタビュープロセスが利用できません [${namespace}]`,
          "error",
        );
        socket.emit("interview_result", "インタビュープロセスが開始されていません。");
      }
    });

    socket.on("disconnect", () => {
      log(`[ユーザー ${socket.id} (ログインID: ${loginID})] ユーザーが切断しました [${namespace}]`);
      if (interviewProcess) {
        interviewProcess.kill();
        log(`[ユーザー ${socket.id} (ログインID: ${loginID})] インタビュープロセスを終了しました [${namespace}]`);
      }
      if (inactivityTimeout) {
        clearTimeout(inactivityTimeout);
      }
    });

    // その他のイベントハンドラがあればここに追加
  });
}

// 「質問文作成」用のネームスペースを設定
setupNamespace("create", "interview.mjs");

// 「AI回答」用のネームスペースを設定
setupNamespace("answer", "interview2.mjs");

// `sechat` 用のネームスペースを設定
setupNamespace("sechat", "interview3.mjs");

// エラーハンドリングミドルウェア
app.use((err, req, res, __next) => {
  log(`サーバーエラー: ${err.stack}`, "error");
  res.status(500).json({});
});

server.listen(SOCKET_IO_PORT, () => {
  console.log(
    `サーバーが起動し、ポート${SOCKET_IO_PORT}でリスニングしています`,
  );
});