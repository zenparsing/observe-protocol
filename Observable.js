Symbol.observe = Symbol('observe');

// TODO: We should also throw if the observer is currently executing
// TODO: Account for missing generator methods?

class WrappedObserver {

  constructor(observer, start) {
    this._observer = observer;
    this._state = 'initializing';
    this._cleanup = start(this);
    this._state = 'ready';
  }

  _finalize() {
    if (this._cleanup) {
      let cleanup = this._cleanup;
      this._cleanup = null;
      cleanup();
    }
  }

  _checkResult(result) {
    if (result.done) {
      this._observer = null;
      this._finalize();
    }
    return result;
  }

  _checkReady() {
    if (this._state !== 'ready') {
      throw new Error('Observer is not ready');
    }
  }

  next(value) {
    this._checkReady();
    if (!this._observer) {
      return { done: true };
    }
    return this._checkResult(this._observer.next(value));
  }

  throw(value) {
    this._checkReady();
    if (!this._observer) {
      throw value;
    }
    return this._checkResult(this._observer.throw(value));
  }

  return(value) {
    this._checkReady();
    let observer = this._observer;
    if (!observer) {
      return { done: true };
    }
    try {
      this._observer = null;
      return observer.return(value);
    } finally {
      this._finalize();
    }
  }
}

class Observable {

  constructor(setup) {
    this._setup = setup;
  }

  [Symbol.observe](observer) {
    let wrapped = new WrappedObserver(observer, this._setup);
    return value => void wrapped.return(value);
  }

  subscribe(onNext, onError, onComplete) {
    return this[Symbol.observe]({
      next(value) {
        if (typeof onNext !== 'function') {
          onNext = () => {};
        }
        return onNext(value) || { done: false };
      },
      throw(error) {
        if (typeof onError !== 'function') {
          throw error;
        }
        return onError(error) || { done: false };
      },
      return(value) {
        if (typeof onComplete !== 'function') {
          return { done: true };
        }
        return onComplete(value) || { done: true };
      },
    });
  }

  filter(fn) {
    return new this.constructor(observer =>
      this[Symbol.observe]({
        next: value => fn(value) ? observer.next(value) : { done: false },
        throw: error => observer.throw(error),
        return: value => observer.return(value),
      })
    );
  }

  map(fn) {
    return new Observable(observer =>
      this[Symbol.observe]({
        next: value => observer.next(fn(value)),
        throw: error => observer.throw(error),
        return: value => observer.return(value),
      })
    );
  }

  until(signal) {
    return new Observable(observer => {
      function onSignal() {
        observer.return();
        return { done: true };
      }

      let cancelSignal = Observable.from(signal)[Symbol.observe]({
        next: onSignal,
        throw: onSignal,
        return: onSignal,
      });

      if (observer.done) {
        return;
      }

      let cancel = this[Symbol.observe](observer);

      return () => {
        cancel();
        cancelSignal();
      };
    });
  }

  forEach(fn) {
    return new Promise((resolve, reject) => {
      this[Symbol.observe]({
        next(value) {
          let result = typeof fn === 'function' ? fn(value) : null;
          return result || { done: false };
        },
        throw(value) {
          reject(value);
          return { done: true };
        },
        return(value) {
          resolve(value);
          return { done: true };
        },
      });
    });
  }

  static of(...args) {
    return this.from(args);
  }

  static from(x) {
    if (typeof x[Symbol.observe] !== 'undefined') {
      if (x.constructor === this) {
        return x;
      }
      return new this(observer => x[Symbol.observer](observer));
    }
    return new this(observer => {
      Promise.resolve().then(() => {
        for (let item of x) {
          let result = observer.next(item);
          if (result.done) {
            return;
          }
        }
        observer.return();
      });
    });
  }

}
