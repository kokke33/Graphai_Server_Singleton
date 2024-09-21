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
    methods: ["GET", "POST"],
    credentials: true,
  },
});

function log(message, level = "info") {
  if (console[level]) {
    console[level](`${level.toUpperCase()}: ${message}`);
  } else {
    console.log(`${level.toUpperCase()}: ${message}`);
  }
}

io.on("connection", (socket) => {
  log(`新しいユーザーが接続しました: ${socket.id}`);

  let interviewProcess = null;

  socket.on("start_interview", async () => {
    log(`[ユーザー ${socket.id}] インタビュー開始リクエストを受信しました`);

    try {
      const scriptPath = join(__dirname, "interview.mjs");

      log(
        `[ユーザー ${socket.id}] スクリプトでインタビュープロセスを開始します: ${scriptPath}`,
      );
      interviewProcess = fork(scriptPath, [], {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        execArgv: ["--experimental-modules"],
      });

      if (!interviewProcess) {
        log(
          `[ユーザー ${socket.id}] インタビュープロセスの起動に失敗しました`,
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
          `[ユーザー ${socket.id}] 子プロセスの起動に失敗しました: ${err.message}`,
          "error",
        );
        socket.emit(
          "interview_result",
          `エラー: 子プロセスの起動に失敗しました: ${err.message}`,
        );
      });

      // 子プロセスからのメッセージを処理
      interviewProcess.on("message", (response) => {
        if (response.status === "ready") {
          log(`[ユーザー ${socket.id}] 子プロセスの準備ができました`);
          // 子プロセスに開始メッセージを送信
          interviewProcess.send({ message: "start_interview" });
        } else if (response.response) {
          // 子プロセスからの通常のメッセージ
          log(
            `[ユーザー ${socket.id}] メッセージ受信: ${JSON.stringify(response)}`,
          );

          const messageToSend = response.response.trim();
          if (messageToSend !== "") {
            socket.emit("interview_result", messageToSend);
          }
        } else {
          log(
            `[ユーザー ${socket.id}] 子プロセスからの不明なメッセージ: ${JSON.stringify(response)}`,
            "warn",
          );
        }
      });

      // 子プロセスの終了を処理
      interviewProcess.on("exit", (code, signal) => {
        log(
          `[ユーザー ${socket.id}] インタビュープロセスがコード${code}とシグナル${signal}で終了しました`,
        );
        socket.emit(
          "interview_result",
          `インタビュープロセスが予期せず終了しました。`,
        );
      });
    } catch (error) {
      log(`[ユーザー ${socket.id}] 実行中にエラーが発生しました:`, "error");
      if (error instanceof Error) {
        log(
          `[ユーザー ${socket.id}] エラーメッセージ: ${error.message}`,
          "error",
        );
        log(
          `[ユーザー ${socket.id}] スタックトレース: ${error.stack}`,
          "error",
        );
        socket.emit("interview_result", `エラー: ${error.message}`);
      } else {
        log(`[ユーザー ${socket.id}] 不明なエラー: ${String(error)}`, "error");
        socket.emit("interview_result", "不明なエラーが発生しました");
      }
      log(`[ユーザー ${socket.id}] 現在のPATH: ${process.env.PATH}`, "info");
    }
  });

  socket.on("user_input", (message) => {
    log(`[ユーザー ${socket.id}] メッセージ受信: ${message}`);

    // ユーザー入力の検証とサニタイズ
    if (typeof message !== "string" || message.trim() === "") {
      log(`[ユーザー ${socket.id}] 無効な入力が検出されました`, "warn");
      return;
    }

    if (interviewProcess) {
      log(
        `[ユーザー ${socket.id}] インタビュープロセスにメッセージ"${message}"を書き込みます`,
      );
      interviewProcess.send({ message });
    } else {
      log(
        `[ユーザー ${socket.id}] インタビュープロセスが利用できません`,
        "error",
      );
    }
  });

  socket.on("disconnect", () => {
    log(`[ユーザー ${socket.id}] ユーザーが切断しました`);
    if (interviewProcess) {
      interviewProcess.kill();
      log(`[ユーザー ${socket.id}] インタビュープロセスを終了しました`);
    }
  });
});

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
