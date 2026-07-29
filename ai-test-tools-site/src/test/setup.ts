import '@testing-library/jest-dom/vitest'

// jsdom 未实现 IntersectionObserver，为依赖它的组件（如 SplitText）提供空实现
class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly scrollMargin = '0px'
  readonly thresholds = [0]

  constructor(
    _callback: IntersectionObserverCallback,
    _options?: IntersectionObserverInit,
  ) {
    void _callback
    void _options
  }

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: IntersectionObserverStub,
  })
}

// jsdom 未实现 ResizeObserver，为走马灯等需要测量容器宽度的组件提供空实现
class ResizeObserverStub implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {
    void _callback
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  })
}
