---
title: "Kubernetes Operator 开发"
date: 2023-06-23T00:30:13+08:00
draft: false
categories: ["article"]
length: 0
description: "[迁移]开发 Operator 的指南"
---

Kubernetes 通过命令行（kubectl）或者 YAML 的方式将请求数据转换为 JSON，然后发送到 API Server，不同的资源会有不同的 Controller 来负责，Controller 维护了这些资源的期望状态。
例如 Pod、Service 等，这都是 Kubernetes 中预定义的对象，对于自定义的对象，我们就需要通过 Operator 来实现了。

Operator 概念由 CoreOS 的 CTO Brandon Philips 在2016年提出，SRE通过编写运维软件来运维应用，他们是工程师，也是开发者，知道怎么针对特定应用领域来开发运维软件，这些运维软件中包含特定应用领域的运维经验。
我们把这种新的软件类型叫作 Operator。

# 前言

一个 Operator 是特定应用的控制器，通过拓展 Kubernetes API 来创建、配置和管理复杂有状态的应用实例，代替用户人工操作。它构建在 Kubernetes Resource 和 Controller 概念之上，同时包含领域或应用特定的知识，从而自动化地实现通用的运维任务。
Operator 模式是 Kubernetes 高度可拓展性的精髓所在，官方文档对 Operator 模式的介绍可以在中找到：[https://kubernetes.io/zh-cn/docs/concepts/extend-kubernetes/operator/](https://kubernetes.io/zh-cn/docs/concepts/extend-kubernetes/operator/)。Operator 的初衷在于人们都喜欢通过自动化来处理重复的任务，通过 Operator 来封装这些繁琐的流程。

Operator 可以做的事情如下：

- 按需部署应用。
- 获取/还原应用状态的备份。
- 处理应用代码的升级以及相关改动。例如数据库 Schema 或额外的配置设置。
- 发布一个 Service，要求不支持 Kubernetes API 的应用也能发现它。
- 模拟整个或部分集群中的故障以测试其稳定性。
- 在没有内部成员选举程序的情况下，为分布式应用选择首领角色。

一个典型的 Operator 如下：

- 定义一个 Kubernetes 自定义资源，例如叫做 SampleDB。
- 一个包含 Operator Controller 部分的 Deployment（用于无状态的 CRD） 或者 StatefulSet（用于有状态的 CRD），用来确保 Pod 处于 Running 状态。
- 包含 Operator 代码的容器镜像。
- Controller 代码，负责查询控制平面找出已经配置的 SampleDB 资源。
- Operator 的核心是告诉 API Server，如何使现有 Kubernetes 集群状态与代码里配置的资源匹配，例如：
    - 如果添加新的 SampleDB，Operator 将设置 PersistentVolumeClaims 以提供持久化的数据库存储， 设置 StatefulSet 以运行 SampleDB，并设置 Job 来处理初始配置。
    - 如果你删除它，Operator 将建立快照，然后确保 StatefulSet 和 Volume 已被删除。
- Operator 也可以管理常规数据库的备份。对于每个 SampleDB 资源，Operator 会确定何时创建（可以连接到数据库并进行备份的）Pod。这些 Pod 将依赖于 ConfigMap 和/或具有数据库连接详细信息和凭据的 Secret。
- 由于 Operator 旨在为其管理的资源提供强大的自动化功能，因此它还需要一些额外的支持性代码。 在这个示例中，代码将检查数据库是否正运行在旧版本上， 如果是，则创建 Job 对象为你升级数据库。

部署 Operator 之后，可以通过 kubectl 命令来操作 SampleDB 这个对象，例如：

```shell
watch kubectl get SampleDB -o wide
```

那么，Operator 会负责应用所作的更改并保持现有服务处于良好的状态。

# 开发

如果生态系统中没可以实现你目标的 Operator，你可以自己编写代码。你还可以使用任何支持 Kubernetes API 客户端的语言或运行时来实现 Operator（即 Controller）。

- 如果你使用 Java，那么可以使用 [https://github.com/operator-framework/java-operator-sdk](https://github.com/operator-framework/java-operator-sdk) 实现。
- 如果你使用 Python，那么可以使用 [https://github.com/nolar/kopf](https://github.com/nolar/kopf) 实现。

通常情况下，我们推荐使用 Go 语言实现 Operator，毕竟 Kubernetes 也是使用 Go 语言开发的，那么我们就会用到 [https://book.kubebuilder.io/](https://book.kubebuilder.io/)。

### 安装依赖

目前 kubebuilder 仅支持 Linux 和 macOS，Windows 用户可以使用 WSL 来实现。下面我们来安装 kubebuilder:

```shell
apt update && apt upgrade -y && apt install wget curl golang git make -y
curl -L -o kubebuilder "https://go.kubebuilder.io/dl/latest/$(go env GOOS)/$(go env GOARCH)"
chmod +x kubebuilder && mv kubebuilder /usr/local/bin/
```

接下来我们看一下版本信息：

```shell
kubebuilder version
```

看到输出了版本信息，说明安装成功了：

```shell
Version: main.version{KubeBuilderVersion:"3.11.1", KubernetesVendor:"1.27.1", GitCommit:"1dc8ed95f7cc55fef3151f749d3d541bec3423c9", BuildDate:"2023-07-03T13:10:56Z", GoOs:"linux", GoArch:"amd64"}
```

### 创建项目

Kubebuilder 依赖于 Go 语言环境、Docker 和 Kubectl（确保可以访问到测试环境的 Kubernetes 集群）。

我们创建一个简单的 Operator，快速了解 Operator 的初始化、API 定义、打包和发布。我们要通过一个 Application 类型来定义一个自己的资源对象，然后在控制器中获取这个资源对象的详细配置，接着根据它的配置去创建相应数量的 Pod ，就像 Deployment 那样工作。

```shell
mkdir helloworld-operator && cd helloworld-operator
kubebuilder init --domain=example.com --repo=github.com/bluemiaomiao/helloworld-operator --owner "Halo Hsu" --skip-go-version-check
```

项目初始化完成以后会有很多目录和文件，其主要功能如下：

- ``PROJECT``：项目的元数据。
- ``main.go``：主进程文件。
- ``config``：分门别类的存放了许多 YAML 配置文件。
- ``Dockerfile``：编译和构建二进制的全部逻辑都在这里。
- ``Makefile``：通过 make 命令构建 Operator 应用。

接下来我们创建一个自定义资源：

```shell
kubebuilder create api --group myapp --version v1 --kind HelloWorld
```

kubebuilder 帮助我们创建了 ``config`` 目录中的相关配置，``controllers`` 目录中的一些文件，以及 ``api`` 目录。

- ``api`` 目录包含了刚才添加的 API，需要注意 ``helloworld_types.go`` 文件。
- ``config/crd`` 存放的是用于部署 CRD 的 kustomize 文件。
- ``config/rabc`` 存放了用于查询和编辑权限的 ClusterRole 配置文件。
- ``samples/myapp_v1_helloworld.yaml`` 是一个 CR 的示例文件，通过这个文件就可以创建一个我们自定义的 HelloWorld 类型资源。
- ``controllers`` 包含了控制器代码的逻辑入口，需要重点关注 ``Reconcile`` 方法。

### 实现 CRD

编辑 ``api/v1/helloworld_types.go`` 文件，添加一些属性：

```go
type HelloworldSpec struct {
    Replicas int32                  `json:"replicas,omitempty"`  // Pod 的数量
    Template corev1.PodTemplateSpec `json:"template,omitempty"`  // Pod 的模板定义
}
```

### 构建与部署

修改好之后，就可以构建清单文件了：

```shell
make manifests
```

构建完成后会在 ``config/crd/bases`` 目录中新增 ``myapp.example.com_helloworld.yaml`` 文件，其中 Kind 是 ``CustomResourceDefintion`` 类型。
``spec.group`` 是 ``myapp.example.com``，``spec.kind`` 是 ``Hellworld`` 类型。

接下来通过执行 ``make install`` 将 CRD 部署到 Kubernetes 集群中，然后就可以通过 kubectl 可以看到我们实现的 CRD：

```shell
kubectl get crd
kubectl get helloworld
```

此时 API Server 已经识别这种资源了。我们可以通过编写 YAML 来创建 CRD，但是并不会有任何 Pod 被创建出来，因为还没有实现 ``Reconcile()`` 方法。

通过 ``make run`` 实现测试运行，此时会打印大量的日志到标准输出。

### 在集群上运行

```shell
make docker-build docker-push IMG=<some-registry>/<project-name>:tag
```

将控制器部署到具有指定镜像的集群:

```shell
make deploy IMG=<some-registry>/<project-name>:tag
```

如果你要取消 CRD 并卸载：

```shell
make undeploy
make uninstall
```

到这里，我们知道了开发一个 Operator 的具体步骤，接下来的章节将会与 Operator 有关。

# Kubernetes API

kube-apiserver 通过 HTTPS 来通信，而且是 TLS 认证，在开发 Operator 的时候，重点关注的是 Kubernetes API 本身，因此可以通过 ``kubectl proxy --port=9090`` 来进行代理。
此时，通过 curl 或者 Postman 就可以与 Kubernetes 通信了，Kubernetes API 是标准的 Restful API。

与 API 关系比较大的是 GVK 这个概念，也就是：Group、Version、Kind。
我们在描述Kubernetes API时经常会用到这样一个四元组：Groups、Versions、Kinds 和 Resources。

一个 Group 表示的是一些相关功能的集合，比如 apps 这个 Group 里面就包含 deployments、replicasets、daemonsets、statefulsets 等资源，这些资源都是应用工作负载相关的，也就放在了同一个 Group 下。
一个 Group 可以有一个或多个 Version，不难理解这里的用意，毕竟随着时间的推移，一个 Group 中的 API 难免有所变化。

每一个 Group 中会有不同类型的 API，这就需要使用 Kind 来描述了，每个 Kind 在不同的版本中一般会有所差异，但是每个版本的 Kind 要能够存储其他版本 Kind 的资源类型，无论是通过存储在字段里实现还是通过存储在注解中实现。
这也就意味着使用老版本的 API 存储新版本类型数据不会引起数据丢失或污染。

至于 Resources，指的是一个 Kind 的具体使用，比如Pod类型对应的资源是 pods。
Kind 和 Resources 往往是一一对应的，尤其是在 CRD 的实现上。常见的特例就是为了支持 HorizontalPodAutoscaler(HPA) 和不同类型交互，Scale 类型对应的资源有 deployments/scale 和 replicasets/scale 两种。

# client-go 库

client-go 项目就是用于和 Kubernetes API Server 通信的 Go 语言开发工具包。虽然使用 kubebuilder 已经屏蔽了不少 client-go 的细节，但是要深入 Operator 开发机制，还是需要对 client-go 有一定的了解。

client-go 的存储库地址是：[https://github.com/kubernetes/client-go](https://github.com/kubernetes/client-go)。这个库的代码是以每天一次的频率从 ``kubernetes/kubernetes`` 存储库库中自动同步过来的。
如果你想直接使用该库，可以在项目中直接添加依赖：

```shell
go get k8s.io/client-go@laest
```

对于 client-go 的认证，分为集群内和集群外，集群内部 Kubernetes 会自动挂载 ServiceAccunt 中的 JWT 和 ca.crt，集群外部直接使用 kubeconfig 文件即可。

编写自定义控制器依赖多个 client-go 组件，下面我们介绍 client-go 中的几个机制。

![](/article/kubernetes-operator/operator-arch.svg)

- Reflector 从 API Server 监听 (Watch) 特定类型的资源，拿到变更通知后，将其 Push 到 DeltaFIFO 队列中。
- Informer 从 DeltaFIFO 中 Pop 出对象，然后通过 Indexer 将对象和索引放到本地缓存中，再触发相应的事件处理函数(Resource Event Handlers)。
- Indexer 主要提供一个对象根据一定条件检索的能力，典型的实现是通过 namespace/name 来构造key，通过 Thread Safe Store 来存储对象。
- WorkQueue 一般使用的是延时队列实现，在 Resource Event Handlers 中会完成将对象的 key 放入 WorkQueue 的过程，然后在自己的逻辑代码里从 WorkQueue 中消费这些 key。
- ClientSet提供的是资源的读写能力，与 API Server 交互。
- 我们一般在 Resource Event Handlers 中添加一些简单的过滤功能，判断哪些对象需要加到 WorkQueue 中进一步处理，对于需要加到 WorkQueue 中的对象，就提取其 key，然后 Push 到队列中。
- Worker 指的是我们自己的业务代码处理过程，在这里可以直接收到 WorkQueue 中的任务，可以通过 Indexer 从本地缓存检索对象，通过 ClientSet 实现对象的增、删、改、查逻辑。

## WorkQueue

WorkQueue 称为工作队列，Kubernetes 的 WorkQueue 队列与普通 FIFO（先进先出，First-In, First-Out）队列相比，实现略显复杂，它的主要功能在于标记和去重，并支持如下特性。

- 有序：按照添加顺序处理元素（item）。
- 去重：相同元素在同一时间不会被重复处理，例如一个元素在处理之前被添加了多次，它只会被处理一次。
- 并发性：多生产者和多消费者。
- 标记机制：支持标记功能，标记一个元素是否被处理，也允许元素在处理时重新排队。
- 通知机制：ShutDown 方法通过信号量通知队列不再接收新的元素，并通知 metric goroutine 退出。
- 延迟：支持延迟队列，延迟一段时间后再将元素存入队列。
- 限速：支持限速队列，元素存入队列时进行速率限制。限制一个元素被重新排队（Reenqueued）的次数。
- 指标：支持监控指标，可用于 Prometheus 监控。

WorkQueue 主要有3个队列：普通队列、延时队列和限速队列。后一个队列以前一个队列的实现为基础，层层添加新功能。

### 普通队列

FIFO 队列支持最基本的队列方法，WorkQueue 中的限速及延迟队列都基于 Interface 接口实现：

```go
type Interface interface {
    Add(item interface{})
    Len() int
    Get() (item interface{}, shutdown bool)
    Done(item interface{})
    ShutDown()
    ShuttingDown() bool
}
```

FIFO 队列的类型定义如下：

```go
type Type struct {
    queue []t
    dirty set
    processing set
    cond *sync.Cond
    shuttingDown bool
    metrics queueMetrics
    unfinishedWorkUpdatePeriod time.Duration
    clock clock.Clock
}
```

``queue`` 字段用来存储真正的元素，``t`` 类型的 Slice 结构，保证了元素的有序。
``dirty`` 字段保证了队列去重功能，还能保证并发情况下只处理一次。
``processing`` 字段用于标记机制，标记一个元素是否正在被处理。

在并发场景下，假设 Goroutine A 通过 Get 方法获取 1 元素，1 元素被添加到 ``processing`` 字段中，同一时间，Goroutine B 通过 Add 方法插入另一个 1 元素，此时在 ``processing`` 字段中已经存在相同的元素，
所以后面的 1 元素并不会被直接添加到 ``queue`` 字段中，当前 FIFO 队列中的 ``dirty`` 字段中存有 1、2、3 元素，``processing`` 字段存有 1 元素。在 Goroutine A 通过 Done 方法标记处理完成后，如果 ``dirty`` 字段中存有 1 元素，
则将 1 元素追加到 ``queue`` 字段中的尾部。需要注意的是，``dirty`` 和 ``processing`` 字段都是用 HashMap 数据结构实现的，所以不需要考虑无序，只保证去重即可。

### 延迟队列

延迟队列，基于 FIFO 队列接口封装，在原有功能上增加了 ``AddAfter`` 方法，其原理是延迟一段时间后再将元素插入 FIFO 队列。

```go
type DelayingInterface interface {
    Interface
    AddAfter(item interface{}, duration time.Duration)
}

type delayingType struct {
    Interface
    clock clock.Clock
    stopCh chan struct{}
    heartbeat clock.Ticker
    waitingForAddCh chan *waitFor
    metrics           retryMetrics
    deprecatedMetrics retryMetrics
}
```

``delayingType`` 结构中最主要的字段是 ``waitingForAddCh``，其默认初始大小为 1000，通过 ``AddAfter`` 方法插入元素时，是非阻塞状态的，只有当插入的元素大于或等于 1000 时，延迟队列才会处于阻塞状态。
``waitingForAddCh`` 字段中的数据通过 Goroutine 运行的 ``waitingLoop`` 函数持久运行。

将元素 1 放入 ``waitingForAddCh`` 字段中，通过 ``waitingLoop`` 函数消费元素数据。当元素的延迟时间不大于当前时间时，说明还需要延迟将元素插入 FIFO 队列的时间，此时将该元素放入优先队列（``waitForPriorityQueue``）中。
当元素的延迟时间大于当前时间时，则将该元素插入 FIFO 队列中。另外，还会遍历优先队列（``waitForPriorityQueue``）中的元素，按照上述逻辑验证时间。

### 限速队列

限速队列，基于延迟队列和 FIFO 队列接口封装，限速队列接口（``RateLimitingInterface``）在原有功能上增加了 ``AddRateLimited``、``Forget``、``NumRequeues`` 方法。
限速队列的重点不在于 ``RateLimitingInterface`` 接口，而在于它提供的 4 种限速算法接口（``RateLimiter``）。其原理是，限速队列利用延迟队列的特性，延迟某个元素的插入时间，达到限速目的。

```go
type RateLimiter interface {
    When(item interface{}) time.Duration
    Forget(item interface{})
    NumRequeues(item interface{}) int
}
```

4中限速算法分别是：令牌桶算法（``BucketRateLimiter``）、排队指数算法（``ItemExponentialFailureRateLimiter``）、
计数器算法（``ItemFastSlowRateLimiter``）和混合模式（``MaxOfRateLimiter``），将多种限速算法混合使用混合模式（``MaxOfRateLimiter``），将多种限速算法混合使用。

令牌桶算法是通过 Go 语言的第三方库 ``golang.org/x/time/rate`` 实现的。
令牌桶算法内部实现了一个存放 Token（令牌）的“桶”，初始时“桶”是空的，Token 会以固定速率往“桶”里填充，直到将其填满为止，多余的 Token 会被丢弃。
每个元素都会从令牌桶得到一个 Token，只有得到 Token 的元素才允许通过，而没有得到 Token 的元素处于等待状态。
**令牌桶算法通过控制发放 Token 来达到限速目的。** WorkQueue 在默认的情况下会实例化令牌桶算法。

排队指数算法将相同元素的排队数作为指数，排队数增大，速率限制呈指数级增长，
但其最大值不会超过 ``maxDelay``。元素的排队数统计是有限速周期的，一个限速周期是指从执行 ``AddRateLimited`` 方法到执行完 ``Forget`` 方法之间的时间。如果该元素被 ``Forget`` 方法处理完，则清空排队数。

计数器算法是限速算法中最简单的一种，其原理是：限制一段时间内允许通过的元素数量，例如在 1 分钟内只允许通过 100 个元素，
每插入一个元素，计数器自增 1，当计数器数到 100 的阈值且还在限速周期内时，则不允许元素再通过。但 WorkQueue 在此基础上扩展了 ``fast`` 和 ``slow`` 速率。

## DeltaFIFO

DetlaFIFO 同时实现了 ``Queue`` 和 ``Store`` 接口，使用 ``items`` 保存了对象状态的变更，并且它们是内嵌关系：

```go
type Queue interface {
    Store
}
```

```go
type DeltaFIFO struct {
    items map[string]string Deltas
}
```

``DeltaFIFO`` 存储元素使用了 ``Deltas`` 类型，``Deltas`` 类型是一个类型别名：

```go
type Deltas []Delta
```

``Delta`` 类型由 ``Type`` 和 ``Object`` 构成。``Type`` 是 ``DeltaType`` 类型的，本质上是模拟了枚举。而 ``Object`` 是 ``any`` 类型的。

## ListerWatcher

ListerWatcher 是 Lister 和 Watcher 的结合体，前者负责列举全量对象，后者负责监视对象的增量变化。
Kubernetes 将对象全部存储到 ETCD 中，并且只能通过 API Server 访问，如果很多客户端频繁的列举对象，会给 API Server 造成重负，因此，ListerWatcher 是带有本地缓存功能的。
增量监视 ETCD 中的对象变化，并将这些差异更新到本地缓存。这里的本地缓存就是 Indexer，还带有索引加速功能。

Lister 是一个接口：

```go
type Lister interface {
    List(options metav1.ListOptions) (runtime.Object, error)
}
```

同样 Watcher 也是个接口：

```go
type Watcher interface {
    Watch(options metav1.ListOptions) (watch.Interface, error)
}
```

因此 ListerWatcher 接口就是将这两个接口进行了合并操作。ListerWatcher 主要用于创建各种 API 对象的 SharedIndexInformer，实现就是 Clientset 提供的 List 和 Watch 函数。

## Informer

Informer（也叫做 SharedInformer）是 Kubernetes 控制器（Controller）中的模块，
是控制器调谐循环（Reconcile Loop）与 Kubernetes API Server 事件（也就是 ETCD 中 Kubernetes API 数据变化）挂接的桥梁，
我们通过 API Server 增删改某个 Kubernetes API 对象，该资源对应的控制器中的 Informer 会立即感知到这个事件并作出调谐。

```go
type SharedIndexInformer interface {
    SharedInformer
    AddIndexers(indexers Indexers) error
    GetIndexer() Indexer
}

type sharedIndexInformer struct {
    indexer    Indexer
    controller Controller
    processor             *sharedProcessor
    cacheMutationDetector MutationDetector
    listerWatcher ListerWatcher
    objectType runtime.Object
    resyncCheckPeriod time.Duration
    defaultEventHandlerResyncPeriod time.Duration
    clock clock.Clock
    started, stopped bool
    startedLock      sync.Mutex
    blockDeltas sync.Mutex
}
```

可以看到 Informer 由三部分构成：

- Reflector：Informer 通过 Reflector 与 Kubernetes API Server 建立连接并 ListAndWatch Kubernetes 资源对象的变化，并将此“增量” Push 到 DeltaFIFO Queue 中。
- DeltaFIFO Queue：Informer 从该队列中 pop 增量，或创建或更新或删除本地缓存（Local Store）。
- Indexer：将增量中的 Kubernetes 资源对象保存到本地缓存中，并为其创建索引，这份缓存与 etcd 中的数据是完全一致的。

Watch 方法的实现是一个典型的 HTTP 请求，但是 Kubernetes apiserver 首次应答的 HTTP Header 中会携带上 ``Transfer-Encoding: chunked``，表示分块传输，客户端会保持这条 TCP 连接并等待下一个数据块。
如此 API Server 会主动将监听的 Kubernetes 资源对象的变化不断地推送给客户端。