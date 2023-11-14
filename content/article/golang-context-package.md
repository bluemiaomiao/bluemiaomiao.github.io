---
title: "Golang 的 context 包源码分析"
date: 2021-12-19T01:00:50+08:00
draft: false
categories: ["article"]
length: 0
description: "[迁移] 一个只有400多行代码的常用包"
---

本文将会详细分析 ``context`` 这个包，Go 语言几乎是伴随着 Kubernetes 而知名，Kubernetes 正是云原生的明星框架。
云原生意味着需要大量的线程处理 I/O 请求。Go 语言正好提供了强大的 I/O 处理能力，并且还简化了编程模型。
在 Go 处理 I/O 任务时，往往一个任务关联更多的任务，典型的场景就是 Web API，通常一个 API 下可能包含多个中间件和其他 API
的连接。因此使用抽象的方式对这些 I/O 任务进行控制变得尤为重要。

![](/article/golang-context-package/context-tree.svg)

**Context 中的 Event 具有传播行为，当前 Context 发生的 Event 会传播给全部的子节点。**

# Context

``context`` 库使用树的结构描述多个任务之间的关系，在代码中通常体现为 ``context`` 类型的变量作为函数或者方法参数传递。
``context`` 库定义了一个 ``Context`` 的接口，包含了我们常用的方法：

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool) // 返回 deadline，是截止日期，表示任务的完成时间
    Done() <-chan struct{} // 如果任务完成，那么只读 Channel 将会永远关闭
    Err() error // 返回错误，如果还没有被 Done 完成，那么就是 nil，且会在取消函数CancelFunc执行完之后发生
    Value(key any) any // 返回上下文携带的元数据
}
```

``Done()`` 方法的返回值类型是个只读的，并且 Channel 中的数据类型是 ``struct{}``，说明不返回任何数据，因此 ``struct{}`` 只是个内存占位。

``Context`` 由 ``emptyCtx`` 结构体实现：

```go
type emptyCtx int
```

``emptyCtx`` 除了 ``Context`` 接口中的方法，还实现了 ``String()`` 方法：

```go
func (e *emptyCtx) String() string {
	switch e {
	case background:
		return "context.Background"
	case todo:
		return "context.TODO"
	}
	return "unknown empty Context"
}
```

用来返回当前 Context 类型的字符串表示。

在 Go 语言中，变量首字母大写的为导出的函数或者变量，那么在 ``context`` 中，导出了如下的功能：

```go
// 几个错误
var Canceled = errors.New("context canceled") // Context 取消时返回的错误
var DeadlineExceeded error = deadlineExceededError{} // Context 超过 deadline 时的错误

// 几个函数
type CancelFunc func()
type CancelCauseFunc func(cause error)

// 返回 Context 被取消的原因
func Cause(c Context) error {
    ...
}

// 创建 Context 的方法
func Background() Context {
	return background
}

func TODO() Context {
	return todo
}

// 一些 WithXxx 方法
func WithCancel(parent Context) (ctx Context, cancel CancelFunc) {
    ...
}

func WithCancelCause(parent Context) (ctx Context, cancel CancelCauseFunc) {
    ...
}

func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
    ...
}

func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc) {
    ...
}

func WithValue(parent Context, key, val any) Context {
    ...
}
```

# 几个错误

``Canceled`` 很简单，只是一个 errors 包创建的常量，没什么可说的。

``DeadlineExceeded`` 虽然也是一个 error 类型，但是是使用 ``deadlineExceededError`` 结构体创建的，其下面有3个方法：

```go
type deadlineExceededError struct{}

func (deadlineExceededError) Error() string   { return "context deadline exceeded" }
func (deadlineExceededError) Timeout() bool   { return true }
func (deadlineExceededError) Temporary() bool { return true }
```

# 创建 Context

``Background()`` 和 ``TODO()`` 函数都是返回同样的 Context，但是 TODO 更适合任何场景，``Background()`` 用于 Root Context 场景。本质上的实现逻辑是一样的：

```go
var (
	background = new(emptyCtx)
	todo       = new(emptyCtx)
)
```

# 增强 Context

## WithCancel 方法

``WithCancel()`` 方法实现了 ``canceler`` 接口，其包含两个方法：

```go
type canceler interface {
	cancel(removeFromParent bool, err, cause error)
	Done() <-chan struct{}
}
```

WithXxx 方法主要是增强 Context 的功能，例如 ``WithCancel()`` 方法用于为 Context 添加可取消能力。``WithCancel()`` 方法本质是调用了 ``withCancel()`` 方法：

```go
func WithCancel(parent Context) (ctx Context, cancel CancelFunc) {
	c := withCancel(parent)
	return c, func() { c.cancel(true, Canceled, nil) }
}
```

而 ``withCancel()`` 方法的主要任务就是返回一个 ``cancelCtx`` 对象：

```go
func withCancel(parent Context) *cancelCtx {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	c := newCancelCtx(parent)
	propagateCancel(parent, c)
	return c
}
```

其中 ``newCancelCtx()`` 方法是创建返回值对象的工厂函数。

```go
type cancelCtx struct {
	Context

	mu       sync.Mutex            // protects following fields
	done     atomic.Value          // of chan struct{}, created lazily, closed by first cancel call
	children map[canceler]struct{} // set to nil by the first cancel call
	err      error                 // set to non-nil by the first cancel call
	cause    error                 // set to non-nil by the first cancel call
}
```

在 ``newCancelCtx()`` 方法内部将原来的 Context 传递给 ``cancelCtx`` 内部的 ``Context`` 字段。由于 Context 在多个 Goroutine 中并发的被修改，因此通过 ``mu`` 这个互斥锁来保护数据。
``err`` 和 ``cause`` 虽然都是错误类型，但是 ``err`` 支持存储了错误，``cause`` 存储了错误原因。``children`` 字段保存了当前 Context 节点下面的全部子 Context 节点。

``propagateCancel`` 将父 Context 节点和新的 Context 节点传入，是用来判断父节点是否一个被 Done，如果 Done，那么全部子节点也应该 Done，通过一个 Goroutine 实现的：

```go
func propagateCancel(parent Context, child canceler) {
	...
		goroutines.Add(1)
		go func() {
			select {
			case <-parent.Done():
				child.cancel(false, parent.Err(), Cause(parent))
			case <-child.Done():
			}
		}()
    ...
}
```

## WithCancelCause

``WithCancelCause`` 更加简单，本质上就是带有 Cause 的 ``WithCancel()`` 方法：

```go
func WithCancelCause(parent Context) (ctx Context, cancel CancelCauseFunc) {
	c := withCancel(parent)
	return c, func(cause error) { c.cancel(true, Canceled, cause) }
}
```

其中参数 ``CancelCauseFunc`` 用于设置读取 Cause 的回调函数。

```go
type CancelCauseFunc func(cause error)
```

## WithDeadline

``WithDeadline()`` 方法是具有 Timer 定时功能的 ``WithCancel()`` 方法，其主要逻辑如下：

```go
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
	...
	c := &timerCtx{
		cancelCtx: newCancelCtx(parent),
		deadline:  d,
	}
	propagateCancel(parent, c)
	...
    if c.err == nil {
		c.timer = time.AfterFunc(dur, func() {
			c.cancel(true, DeadlineExceeded, nil)
		})
	}
    ...
	return c, func() { c.cancel(true, Canceled, nil) }
}
```

可以看到方法内部创建一个 ``timerCtx`` 结构体：

```go
type timerCtx struct {
	*cancelCtx
	timer *time.Timer // Under cancelCtx.mu.

	deadline time.Time
}
```

``timerCtx`` 在 ``cancelCtx`` 的基础之上加入了 ``time.Timer`` 定时器和 ``deadline`` 作为超时时间。
并且，``timerCtx`` 结构体还提供了更多的方法：

```go
func (c *timerCtx) Deadline() (deadline time.Time, ok bool) {
	return c.deadline, true
}

func (c *timerCtx) String() string {
	return contextName(c.cancelCtx.Context) + ".WithDeadline(" +
		c.deadline.String() + " [" +
		time.Until(c.deadline).String() + "])"
}

func (c *timerCtx) cancel(removeFromParent bool, err, cause error) {
	c.cancelCtx.cancel(false, err, cause)
	if removeFromParent {
		// Remove this timerCtx from its parent cancelCtx's children.
		removeChild(c.cancelCtx.Context, c)
	}
	c.mu.Lock()
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.mu.Unlock()
}
```

``propagateCancel()`` 方法与之前的功能一样，判断子 Context 是否应该 Done。
在 ``WithDeadline()`` 方法中与超时相关的核心是 ``time.AfterFunc()`` 方法，判断该 Context 是否超时，然后 Done。

## WithTimeout

``WithTimeout()`` 方法本质上是一个 ``WithDeadline()`` 方法，但是通过 time 库提供的 ``Add()`` 方法添加了超时时间。

```go
func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc) {
	return WithDeadline(parent, time.Now().Add(timeout))
}
```

## WithValue

Context 可以在整个 Goroutine 的调用链路中传递数据，通常我们推荐在 Context 传递轻量级的数据，尽量减少数据发生拷贝的次数和大小，例如 ``TraceID`` 而不是 ``RequestBody``。

```go
func WithValue(parent Context, key, val any) Context {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	if key == nil {
		panic("nil key")
	}
	if !reflectlite.TypeOf(key).Comparable() {
		panic("key is not comparable")
	}
	return &valueCtx{parent, key, val}
}
```

该方法创建了 ``valueCtx`` 结构体对象，其中的定义如下：

```go
type valueCtx struct {
	Context
	key, val any
}
```

我们可以看到内部使用了 ``any`` 类型来描述 ``key`` 和 ``val``，也就是我们传入的轻量级数据。

至此，我们探究了 context 库的具体原理和实现，短小精悍的库在 Go 项目中到处使用，非常像 Java 或者 C# 中的 ``ThreadLocal``。