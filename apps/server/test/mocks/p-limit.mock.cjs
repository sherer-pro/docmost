module.exports = function pLimit(concurrency) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new TypeError('Expected concurrency to be a positive integer');
  }

  let activeCount = 0;
  const queue = [];

  const drain = () => {
    while (activeCount < concurrency && queue.length > 0) {
      const task = queue.shift();
      activeCount += 1;
      void task
        .run()
        .then(task.resolve, task.reject)
        .finally(() => {
          activeCount -= 1;
          drain();
        });
    }
  };

  const limit = (operation, ...args) =>
    new Promise((resolve, reject) => {
      queue.push({
        run: () => Promise.resolve(operation(...args)),
        resolve,
        reject,
      });
      drain();
    });

  Object.defineProperties(limit, {
    activeCount: { get: () => activeCount },
    pendingCount: { get: () => queue.length },
    clearQueue: {
      value: () => {
        queue.length = 0;
      },
    },
  });

  return limit;
};

// TypeScript default imports access `.default` after Jest maps this ESM-only
// package to the CommonJS test double.
module.exports.default = module.exports;
