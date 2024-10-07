// processPool.js
import { fork } from "child_process";

class ProcessPool {
  constructor(size, scriptPath) {
    this.size = size;
    this.scriptPath = scriptPath;
    this.pool = [];
    this.queue = [];

    for (let i = 0; i < size; i++) {
      this.pool.push(this.createProcess());
    }
  }

  createProcess() {
    const proc = fork(this.scriptPath, [], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      execArgv: ["--experimental-modules"],
    });
    proc.busy = false;

    console.log(`新しい子プロセスを作成しました。PID: ${proc.pid}`);

    // プロセスが終了した場合に再生成
    proc.on("exit", (code, signal) => {
      console.log(`子プロセスが終了しました。コード: ${code}, シグナル: ${signal}`);
      this.pool = this.pool.filter((p) => p !== proc);
      const newProc = this.createProcess();
      this.pool.push(newProc);
      // キューに待機中のクライアントがいる場合、新しいプロセスを割り当て
      if (this.queue.length > 0) {
        const nextClient = this.queue.shift();
        newProc.busy = true;
        nextClient(newProc);
      }
    });

    return proc;
  }

  acquire() {
    return new Promise((resolve) => {
      const availableProc = this.pool.find((p) => !p.busy);
      if (availableProc) {
        availableProc.busy = true;
        resolve(availableProc);
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release(proc) {
    proc.busy = false;
    if (this.queue.length > 0) {
      const nextClient = this.queue.shift();
      proc.busy = true;
      nextClient(proc);
    }
  }
}

export default ProcessPool;
