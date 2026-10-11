export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 500;

export const createHistory = <T>(present: T): History<T> => ({
  future: [],
  past: [],
  present,
});

export const pushState = <T>(history: History<T>, next: T): History<T> => {
  if (next === history.present) {
    return history;
  }
  return {
    future: [],
    past: [...history.past, history.present].slice(-LIMIT),
    present: next,
  };
};

/** 履歴に残さず現在の状態だけを置き換える。選択の変更など、Undoの対象にしない変化に使う。 */
export const replacePresent = <T>(history: History<T>, next: T): History<T> =>
  next === history.present ? history : { ...history, present: next };

export const undo = <T>(history: History<T>): History<T> => {
  const previous = history.past.at(-1);
  if (previous === undefined) {
    return history;
  }
  return {
    future: [history.present, ...history.future],
    past: history.past.slice(0, -1),
    present: previous,
  };
};

export const redo = <T>(history: History<T>): History<T> => {
  const [next, ...rest] = history.future;
  if (next === undefined) {
    return history;
  }
  return {
    future: rest,
    past: [...history.past, history.present],
    present: next,
  };
};
