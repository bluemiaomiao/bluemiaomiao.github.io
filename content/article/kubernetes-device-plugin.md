---
title: "Kubernetes Device Plugin 开发详解"
date: 2023-07-30T16:49:46+08:00
draft: false
categories: ["article"]
length: 0
description: "学习 Device Plugin 开发"
---

云原生最初来描述云上应用的典型架构与特性，随着容器、Kubernetes、Serverless、FaaS技术的演进，CNCF（云原生计算基金会）把云原生的概念更广泛地定义为“让应用更有弹性、容错性、观测性的基础技术，让应用更容易部署、管理的基础软件、让应用更容易编写、编排的运行框架等”，希望能够让开发者最好的利用云的资源、产品和交付能力。云上的资源具备多样性，并且有些硬件资源很难被 Kubernetes 管理。Kubernetes 提供 Extended Resources 和 Device Plugin 方案来实现异构资源的管理。

我在工作的过程中使用了 AMD 和 NVIDIA 显卡来开展 AI 任务，一些对性能要求更高的场景下使用了 FPGA 方案，例如ffmpeg、x264、x265 等音视频工具，亦或是高频交易需要模式识别等场景。在 Kubernetes 集群中运行 TensorFlow、PyTorch等机器学习框架需要用到 PCIe 设备。社区中的 Device Plugin 方案在学术界和工程界具有较大的差异，目前 Device Plugin 只能说是可以用的地步。

为什么需要用 Kubernetes 来管理 PCIe 设备（异构资源）呢？

- 提升部署速度，通过 Docker、Podman 的方式加速部署不同类型或版本的环境。例如在私有镜像仓库中准备多个版本的 CUDA 镜像。
- 提升资源使用率，使用 Kubernetes 进行集中管理。遗憾的是 NVIDIA 提供的 Device Plugin 只能实现简单的 GPU 数量汇报。
- 资源独立，利用容器实现对异构设备的隔离性，避免相互影响。例如 NVIDIA 的多实例 GPU 可以实现一个 GPU 板卡可以承载多个 Pod。

![](/article/kubernetes-device-plugin/1045756-cdna2-tech-1260x709.webp)

# 俯瞰 Device Plugin

通常情况下安装 CUDA 的时候，会通过 CUDA Toolkit Installer 进行安装，这个安装器自带了 CUDA 和 GPU 驱动，但是不同的框架或应用可能使用不同的 CUDA 版本，这就导致 CUDA 版本与 GPU 驱动版本可能不匹配使得无法正常工作。通常来讲 GPU 提供了从硬件层面上的多实例，为了在不同实例上运行不同的 CUDA 版本，我们可以通过 mount bind 的方式（``--device=/dev/nvidia0``）构建容器镜像。在内核层面安装 GPU 驱动，然后在镜像内安装容器中的 GPU 驱动，将物理的 GPU 设备映射到容器中，如下图所示：

![](/article/kubernetes-device-plugin/gpu-containers.svg)

NVIDIA GPU 需要替换 Docker 的 RunC，安装 nvidia-docker2 即可实现自动替换。AMD Instinct 的 ROCm 方案就不需要单独的 RunC。

Kubernetes Extended Resources 通过自定义资源扩展的方式，允许用户分配和使用不是 Kubernetes 中内建的资源，而 Device Plugin 允许第三方设备厂商以插件的方式对设备的调度和生命周期进行管控。Extended Resources 属于 Node 级别的 API，通过 ``application/json-patch+json`` 类型的 HTTP PATCH 请求可以上报资源数量，然后在 Pod YAML 中使用 ``nvidia.com/gpu: 1`` 进行声明。

如果使用 Device Plugin 框架，那么直接遵循框架的编程模型即可。Device Plugin 主要完成两件事情：

- 异构资源的监控与上报
- Pod 所需资源的分配

目前 NVIDIA 提供的 Device Plugin 无法实现更加复杂的调度，例如 GPU 亲和性调度（调度到同一个 NUMA 节点上）、全局 GPU 调度、NV Link/NV Switch 识别等。

![](/article/kubernetes-device-plugin/device-plugin-flow.svg)

Kubelet 中有 Device Plugin Manager，维护了当前 Node 上的设备，并且通知 Kubernetes API Server 资源的清单，Kubernetes API Server 主要的任务就是在 ETCD 中存储这些资源清单。Kubelet 启动以后会创建一个 DaemonSet，这个 DaemonSet 就是我们部署的 Device Plugin，这个 DaemonSet Pod 会向 Kubelet 中的 Device Plugin Manager 发送注册请求，主要做三件事情：汇报设备类型、通知 Unix Socket 位置与通知 API 版本和协议。

Kubelet 上的 Device Plugin Manager 会启动一个 Device Plugin Client 去通过得知的 Unix Socket 连接 DaemonSet Pod 中的 Device Plugin Server（本质是个 gRPC Server）实现 ListAndWatch API。这样 Node 上的设备数量变化就可以在 Kubernetes 上的 Extended Resource 数量上发生变化了。

现有的 Device Plugin 中，如果 Pod 想使用 GPU 资源，直接在 YAML 中这样声明：

```yaml
resources:
  limits:
    nvidia.com/gpu: 2
    amd.com/gpu: 2
```

Kubernetes Scheduler 会选择出满足条件的 Node，然后在 Node 上创建 Pod。具体的过程是 Device Plugin Manager 会在持有的 GPU 列表中选择出 GPU ID，然后通过 Allocate 请求向 Device Plugin Server 发送分配请求，Server 向 Manager 响应（Envs, Devices, Mounts）三元组，然后由 Kubelet 创建容器。

虽然 Kubernetes 提供了 Device Plugin 和 Extended Resources 的方案来管理异构资源，但是目前也有巨大的缺陷：

- 设备调度发生在 Kubelet 层面，也就是 Node 层面，而不是 Cluster 层名，更不是 Data Center 层面。
- 资源上报的信息只有数量，信息不足，精细度也不够。
- 调度策略太简单，并且无法配置，没办法满足复杂场景。

另外的一些 Device Plugin 解决方案：

- Alibaba GPU Share Device Plugin: 阿里巴巴提出的方案，包括 [https://github.com/AliyunContainerService/gpushare-scheduler-extender](https://github.com/AliyunContainerService/gpushare-scheduler-extender) 和 [https://github.com/AliyunContainerService/gpushare-device-plugin](https://github.com/AliyunContainerService/gpushare-device-plugin)。
- RDMA Device Plugin: [https://github.com/Mellanox/k8s-rdma-shared-dev-plugin](https://github.com/Mellanox/k8s-rdma-shared-dev-plugin) 和 [https://github.com/Mellanox/k8s-rdma-sriov-dev-plugin](https://github.com/Mellanox/k8s-rdma-sriov-dev-plugin)。
- FPGA Device Plugin: [https://github.com/Xilinx/FPGA_as_a_Service/tree/master/k8s-device-plugin](https://github.com/Xilinx/FPGA_as_a_Service/tree/master/k8s-device-plugin)
- Intel all Device Plugin: [https://github.com/intel/intel-device-plugins-for-kubernetes](https://github.com/intel/intel-device-plugins-for-kubernetes)
- AMD Device Plugin: [https://github.com/RadeonOpenCompute/k8s-device-plugin](https://github.com/RadeonOpenCompute/k8s-device-plugin)

其他的 Smart NIC 或 InfiniBand 高性能设备厂商也提供了 Device Plugin 方案。

# Kubernetes 上的 Device Plugin 实现

Device Plugin 的实现在 ``pkg/kubelet/cm/devicemanager/`` 下面，对于 Kubelet 来说，入口在 manager.go 文件中：

```text
# tree | grep -Ev "*test*" 的执行结果
.
├── OWNERS
├── checkpoint
│   ├── checkpoint.go
│   └── checkpointv1.go
├── endpoint.go
├── manager.go
├── plugin
│   └── v1beta1
│       ├── api.go
│       ├── client.go
│       ├── handler.go
│       ├── server.go
│       └── stub.go
├── pod_devices.go
├── topology_hints.go
└── types.go
```

types.go 中主要内容是 DeviceRunContainerOptions 和 Manager。前者是个结构体，后者是个接口。
DeviceRunContainerOptions 包含组合容器运行时设置以使用其分配的设备。Manager 管理节点上运行的所有 Device Plugin：

```go
type Manager interface {
	// Start 启动 Device Plugin 注册服务。
	Start(activePods ActivePodsFunc, sourcesReady config.SourcesReady, initialContainers containermap.ContainerMap, initialContainerRunningSet sets.String) error

	// Allocate 配置和为容器中的一个 Pod 分配设备。通过请求的设备资源，
	// Allocate 将与所属的设备插件进行通信，以便进行设置流程，并由设备插件提供运行时设置以使用设备（环境变量，挂载点和设备文件）。
	Allocate(pod *v1.Pod, container *v1.Container) error

	// UpdatePluginResources 根据已经分配给 Pod 的设备更新节点资源。
	// 节点对象由设备管理器提供，用于更新节点容量以反映当前可用的设备。
	UpdatePluginResources(node *schedulerframework.NodeInfo, attrs *lifecycle.PodAdmitAttributes) error

	// Stop 停止管理器
	Stop() error

	// GetDeviceRunContainerOptions 检查我们是否具有为传入的 <pod, container> 缓存的 containerDevices，并返回其找到的 DeviceRunContainerOptions。
	// 如果未找到缓存的状态，则返回空结构体。
	GetDeviceRunContainerOptions(pod *v1.Pod, container *v1.Container) (*DeviceRunContainerOptions, error)

	// GetCapacity 返回节点上注册的 Device Plugin 资源的可用容量、可分配资源和非活动 Device Plugin 资源的数量。
	GetCapacity() (v1.ResourceList, v1.ResourceList, []string)
	GetWatcherHandler() cache.PluginHandler

	// GetDevices 返回分配给Pod和容器的设备信息
	GetDevices(podUID, containerName string) ResourceDeviceInstances

	// GetAllocatableDevices 返回有关所有已知设备的信息给管理器
	GetAllocatableDevices() ResourceDeviceInstances

	// ShouldResetExtendedResourceCapacity 根据检查点文件的可用性，返回是否应该重置 Extended Resource 的信息。缺少检查点文件强烈暗示节点已被重建。
	ShouldResetExtendedResourceCapacity() bool

	// TopologyManager HintProvider 提供者表示设备管理器实现了 TopologyManager 接口，并且被用于使拓扑感知资源对齐。
	GetTopologyHints(pod *v1.Pod, container *v1.Container) map[string][]topologymanager.TopologyHint

	// TopologyManager HintProvider 提供者指示设备管理器实现了 TopologyManager 接口，并在每个 Pod 上进行资源对齐以使拓扑感知。
	GetPodTopologyHints(pod *v1.Pod) map[string][]topologymanager.TopologyHint

	// UpdateAllocatedDevices 释放绑定到已终止的 Pod 的任何设备。
	UpdateAllocatedDevices()
}
```

Manager 接口主要被 manager.go 中的 ManagerImpl 结构体实现。ManagerImpl 的实例被 NewManagerImpl() 函数创建。
NewManagerImpl() 函数的唯一用途就是判断系统平台以确定合适的 Unix Socket 文件位置（例如：``/var/lib/kubelet/device-plugins/kubelet.sock``），然后传递给 newManagerImpl() 这个内部函数。newManagerImpl() 函数创建了 ManagerImpl 的实例：

```go
func newManagerImpl(socketPath string, topology []cadvisorapi.Node, topologyAffinityStore topologymanager.Store) (*ManagerImpl, error) {
	...
	manager := &ManagerImpl{
		endpoints: make(map[string]endpointInfo),

		allDevices:            NewResourceDeviceInstances(),
		healthyDevices:        make(map[string]sets.String),
		unhealthyDevices:      make(map[string]sets.String),
		allocatedDevices:      make(map[string]sets.String),
		podDevices:            newPodDevices(),
		numaNodes:             numaNodes,
		topologyAffinityStore: topologyAffinityStore,
		devicesToReuse:        make(PodReusableDevices),
	}

	server, err := plugin.NewServer(socketPath, manager, manager)
	...

	manager.server = server
	manager.checkpointdir, _ = filepath.Split(server.SocketPath())

	// The following structures are populated with real implementations in manager.Start()
	// Before that, initializes them to perform no-op operations.
	manager.activePods = func() []*v1.Pod { return []*v1.Pod{} }
	manager.sourcesReady = &sourcesReadyStub{}
	checkpointManager, err := checkpointmanager.NewCheckpointManager(manager.checkpointdir)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize checkpoint manager: %v", err)
	}
	manager.checkpointManager = checkpointManager

	return manager, nil
}
```

在上面的代码中，NewServer() 返回一个初始化的 Device Plugin 注册服务器。此外，newManagerImpl() 函数还创建了 CheckPointManager。

Device Plugin 与 Device Plugin Manager 的交互逻辑在 ``vendor/k8s.io/kubelet/pkg/apis/deviceplugin/v1beta1/api.proto`` 中定义，主要有以下几个 Service：

- Registration：只有一个 Register 方法。
- DevicePlugin：GetDevicePluginOptions，ListAndWatch，GetPreferredAllocation，Allocate，PreStartContainer。重点关注 ListAndWatch 和 Allocate。

这个 Proto 的定义实现在 ``api.pb.go`` 文件中，``constant.go`` 定义了一些常量。这些 API 在 ``plugin/v1beta1/stub.go`` 中导入：

```go
import pluginapi "k8s.io/kubelet/pkg/apis/deviceplugin/v1beta1"
```

所有的请求被挂载到 Stub 结构体上。接下来我们看看 Stub.Register() 方法的实现：

```go
// Register 将 Device Plugin 与指定的资源名称在Kubelet中注册。
func (m *Stub) Register(kubeletEndpoint, resourceName string, pluginSockDir string) error {
	...
	conn, err := grpc.DialContext(ctx, kubeletEndpoint,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
		grpc.WithContextDialer(func(ctx context.Context, addr string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", addr)
		}))
	if err != nil {
		return err
	}
	defer conn.Close()
	client := pluginapi.NewRegistrationClient(conn)
	reqt := &pluginapi.RegisterRequest{
		Version:      pluginapi.Version,
		Endpoint:     filepath.Base(m.socket),
		ResourceName: resourceName,
		Options: &pluginapi.DevicePluginOptions{
			PreStartRequired:                m.preStartContainerFlag,
			GetPreferredAllocationAvailable: m.getPreferredAllocationFlag,
		},
	}

	_, err = client.Register(context.Background(), reqt)
	return err
}
```

这个函数的主要逻辑是创建一个客户端对象，然后调用 Register() 方法，使用 Context 库进行超时控制。对于 ListAndWatch 和 Allocate 也都是同理：

```go
// ListAndWatch 根据更新调用列出设备并更新该列表。
func (m *Stub) ListAndWatch(e *pluginapi.Empty, s pluginapi.DevicePlugin_ListAndWatchServer) error {
	klog.InfoS("ListAndWatch")

	s.Send(&pluginapi.ListAndWatchResponse{Devices: m.devs})

	for {
		select {
		case <-m.stop:
			return nil
		case updated := <-m.update:
			s.Send(&pluginapi.ListAndWatchResponse{Devices: updated})
		}
	}
}
// Allocate 进行模拟分配
func (m *Stub) Allocate(ctx context.Context, r *pluginapi.AllocateRequest) (*pluginapi.AllocateResponse, error) {
	klog.InfoS("Allocate", "request", r)

	devs := make(map[string]pluginapi.Device)

	for _, dev := range m.devs {
		devs[dev.ID] = *dev
	}

	return m.allocFunc(r, devs)
}
```

``plugin/v1beta1/server.go`` 文件主要是通过 Start() 方法启动一个 gRPC Server：

```go
type Server interface {
  ...
}

type server struct {
  ...
}

func NewServer(socketPath string, rh RegistrationHandler, ch ClientHandler) (Server, error) {
	...
	s := &server{
		socketName: name,
		socketDir:  dir,
		rhandler:   rh,
		chandler:   ch,
		clients:    make(map[string]Client),
	}

	return s, nil
}

func (s *server) Start() error {
	...
	s.grpc = grpc.NewServer([]grpc.ServerOption{}...)
  ...
}
```

``plugin/v1beta1/handler.go`` 文件为 Server 对象挂载了许多方法。``plugin/v1beta1/client.go`` 文件核心在于两个接口：

```go
// DevicePlugin 接口提供了访问 Device Plugin 资源、API和UNIX套接字的方法。
type DevicePlugin interface {
	API() api.DevicePluginClient
	Resource() string
	SocketPath() string
}

// Client 接口提供了建立/关闭 gRPC 连接以及运行 Device Plugin gRPC 客户端的方法。
type Client interface {
	Connect() error
	Run()
	Disconnect() error
}
```

客户端通过 Connect() 方法连接后便持有一个 gRPC 客户端对象，通过 Run() 方法调用了 ListAndWatch() 方法发送 gRPC 请求获取资源：

```go
func (c *client) Run() {
	stream, err := c.client.ListAndWatch(context.Background(), &api.Empty{})
	...

	for {
		response, err := stream.Recv()
		...
		c.handler.PluginListAndWatchReceiver(c.resource, response)
	}
}
```

通过调用 Resource() 方法就可以获取资源了。当 Run() 方法被调用后其实就进入了一个死循环，一直在 gRPC 的 Stream 中获取 Device Plugin 的数据，从 Protobuf 文件的定义来看也是如此：

```protobuf
rpc ListAndWatch(Empty) returns (stream ListAndWatchResponse) {}
```

总结一句话就是 Device Plugin 启动后会与 Device Plugin Manager 以 Unix Socket 承载 gRPC Stream 的方式执行 ListAndWatch 实时发生数据交换。

思路再回到 ManagerImpl 这个结构体上，ManagerImpl 持有了不少的数据：

```go
// ManagerImpl is the structure in charge of managing Device Plugins.
type ManagerImpl struct {
	checkpointdir string

	endpoints map[string]endpointInfo // Key 是 ResourceName
	mutex     sync.Mutex

	server plugin.Server

	// activePods 是一个用于列出节点上活动 Pod 的方法，因此在更新分配的设备时可以统计现有 Pod 请求的 DevicePlugin 的数量。
	activePods ActivePodsFunc

	// sourcesReady 提供了 kubelet 配置来源的准备情况，比如 API Server 的更新准备情况。
	// 我们使用它来确定何时可以从检查点状态中清除未使用的pod。
	sourcesReady config.SourcesReady

	// allDevices 保存了当前注册到设备管理器的所有设备。
	allDevices ResourceDeviceInstances

	// healthyDevices 包含所有注册的健康资源名称及其导出的设备ID。
	healthyDevices map[string]sets.String

	// unhealthyDevices 包含所有不健康的设备及其导出的设备ID。
	unhealthyDevices map[string]sets.String

	// allocatedDevices 包含按资源名称键入的已分配设备ID。
	allocatedDevices map[string]sets.String

	// podDevices 包含了 Pod 到分配设备的映射。
	podDevices        *podDevices
	checkpointManager checkpointmanager.CheckpointManager

	// 底层机器上可用的NUMA节点列表
	numaNodes []int

	// 拓扑亲和性存储，设备管理器可查询。
	topologyAffinityStore topologymanager.Store

	// devicesToReuse 包含可重复使用的设备，因为它们已经被分配给 init 容器
	devicesToReuse PodReusableDevices

	// pendingAdmissionPod 在 Admission 阶段包含了该Pod
	pendingAdmissionPod *v1.Pod

	// containerMap为每个pod中的所有容器提供了从 (pod, container) -> containerID 的映射。用于检测在重新启动后运行的 Pod。
	containerMap containermap.ContainerMap

	// containerRunningSet 标识在计算 containerMap 时，容器运行时报告的正在运行的容器中的哪个容器。用于检测在重启时正在运行的 Pod。
	containerRunningSet sets.String
}
```

podDevices 本质是通过读写锁实现的并发安全的 Map：

```go
type podDevices struct {
	sync.RWMutex
	devs map[string]containerDevices // Keyed by podUID.
}
```

我们在这个小结了解了 Device Plugin 在 Kubelet 层面的实现，接下来看看第三方厂商视角下的 Device Plugin。

# 从 Mellanox RDMA 的 Device Plugin 学习

Mellanox Technologies（纳斯达克： MLNX ）是一家在全球范围内为服务器和存储提供端到端Infiniband和以太网互联解决方案的领军企业。
Mellanox 互连解决方案通过低延迟、高吞吐量的强大性能，可以极大的提升数据中心效率，在应用和系统之间快速的传递数据。

> InfiniBand是一种网络通信协议，它在处理器节点之间以及处理器节点和输入/输出节点（如磁盘或存储器）之间提供基于交换机的点到点双向串行链路结构（Fabric）。 
> 
> InfiniBand通过交换机在节点之间直接创建一个专用的受保护通道，并通过InfiniBand适配器管理和执行的远程直接内存访问（RDMA）和发送/接收卸载，方便了数据和消息的移动。 InfiniBand技术包括 SRD、DDR、QDR、FDR、EDR、HDR 和NDR等多种数据传输速率。InfiniBand最重要的一个特点就是高带宽、低延迟，应用于计算机与计算机之间的数据互连。

以上是 Microsoft Bing Chat 对Mellanox的介绍。Mellanox 提供了两种 Device Plugin，一种是 k8s-rdma-sriov-dev-plugin，已经过时；还有一种是 [k8s-rdma-shared-dev-plugin](https://github.com/mellanox/k8s-rdma-shared-dev-plugin)。

我们将代码 Clone 到本地，然后使用 Goland 打开：

```shell
git clone https://github.com/Mellanox/k8s-rdma-shared-dev-plugin.git
cd k8s-rdma-shared-dev-plugin
go mod download
```

单纯去实现 Device Plugin 是比较简单的，难的是让 Kubernetes 具备宏观调度能力，而不是局限到某个 Node 视角上。项目结构如下：

```shell
# tree | grep -Ev "*test*" 的执行结果
.
├── Dockerfile
├── Dockerfile.ubi
├── LICENSE
├── Makefile
├── README.md
├── cmd
│   └── k8s-rdma-shared-dp
│       └── main.go
├── example
├── go.mod
├── go.sum
├── images
│   ├── k8s-rdma-shared-dev-plugin-config-map.yaml
│   ├── k8s-rdma-shared-dev-plugin-ds-pre-1.16.yaml
│   └── k8s-rdma-shared-dev-plugin-ds.yaml
├── pkg
│   ├── resources
│   │   ├── device_selectors.go
│   │   ├── netlink_manager.go
│   │   ├── pci_net_device.go
│   │   ├── rdma_device_spec.go
│   │   ├── resources_manager.go
│   │   ├── server.go
│   │   ├── watcher.go
│   ├── types
│   │   ├── mocks
│   │   │   ├── NetlinkManager.go
│   │   │   ├── PciNetDevice.go
│   │   │   ├── RdmaDeviceSpec.go
│   │   │   ├── ResourceServer.go
│   │   │   └── ResourceServerConnector.go
│   │   └── types.go
│   └── utils
│       └── utils.go
└── scripts
    └── deploy.sh

```

我们可以观察到二进制文件的入口就是 ``cmd/k8s-rdma-shared-dp/main.go`` 文件，主要函数就是 main() 函数，简化后的内容为：

```go
func main() {
	...
	rm := resources.NewResourceManager()
	...
	if err := rm.ValidateConfigs(); err != nil {
		...
	}

	if err := rm.ValidateRdmaSystemMode(); err != nil {
		...
	}

	if err := rm.DiscoverHostDevices(); err != nil {
		...
	}

	if err := rm.InitServers(); err != nil {
		...
	}

	if err := rm.StartAllServers(); err != nil {
		...
	}
	stopPeriodicUpdate := rm.PeriodicUpdate()

	signalsNotifier := resources.NewSignalNotifier(syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT)
	sigs := signalsNotifier.Notify()

	s := <-sigs
	switch s {
	case syscall.SIGHUP:
		if err := rm.RestartAllServers(); err != nil {
			...
		}
	default:
		stopPeriodicUpdate()
		_ = rm.StopAllServers()
		return
	}
}
```

我们来一一分析 main() 函数中主要做了什么事情。首先通过 NewResourceManager() 工厂函数创建了一个 ResourceManager 对象，它持有这些数据：

```go
type resourceManager struct {
	configFile             string
	defaultResourcePrefix  string
	socketSuffix           string
	watchMode              bool
	configList             []*types.UserConfig
	resourceServers        []types.ResourceServer
	deviceList             []*ghw.PCIDevice
	netlinkManager         types.NetlinkManager
	rds                    types.RdmaDeviceSpec
	PeriodicUpdateInterval time.Duration
}
```

这个结构体上有以下这些方法：

- ``ReadConfig()``：读取配置
- ``ValidateConfigs()``：验证配置
- ``ValidateRdmaSystemMode()``：确保RDMA子系统网络命名空间模式是共享的
- ``InitServers()``：初始化服务器
- ``StartAllServers()``：启动全部的服务器
- ``StopAllServers()``：停止全部的服务器
- ``RestartAllServers()``：重启全部的服务器
- ``DiscoverHostDevices()``：发现主机设备
- ``GetDevices()``：获取设备
- ``GetFilteredDevices()``：获取被过滤的设备
- ``PeriodicUpdate()``：定期更新

这些方法都在 ``pkg/types.go`` 中进行了描述：

```go
// ResourceManager manger multi plugins
type ResourceManager interface {
	ReadConfig() error
	ValidateConfigs() error
	ValidateRdmaSystemMode() error
	DiscoverHostDevices() error
	GetDevices() []PciNetDevice
	InitServers() error
	StartAllServers() error
	StopAllServers() error
	RestartAllServers() error
	GetFilteredDevices(devices []PciNetDevice, selector *Selectors) []PciNetDevice
	PeriodicUpdate() func()
}
```

所有 resourceManager 实际上是 ResourceManager 接口的实现类，上面列出的方法会被 main() 函数逐一调用。

首先是通过 ReadConfig() 方法读取配置后传递给 ValidateConfigs() 方法进行验证，如果验证失败就会抛出错误日志。
ValidateRdmaSystemMode() 方法调用了 RdmaSystemGetNetnsMode() 方法，这个方法来自 ``"github.com/vishvananda/netlink`` 包，我们先不去管具体做了什么事情。
接下来是 DiscoverHostDevices() 方法被调用，应该是枚举 PCIe 总线上的设备并添加到 ResourceManager 上：

```go
func (rm *resourceManager) DiscoverHostDevices() error {
	pci, err := ghw.PCI()
	...
	devices := pci.ListDevices()
	if len(devices) == 0 {
		log.Println("Warning: DiscoverHostDevices(): no PCI network device found")
	}

	rm.deviceList = []*ghw.PCIDevice{}

	for _, device := range devices {
		...
		rm.deviceList = append(rm.deviceList, device)
	}

	return nil
}
```

然后紧接着就调用了 InitServers() 进行服务器初始化操作，核心在于通过 newResourceServer() 方法创建资源服务器：

```go
func (rm *resourceManager) InitServers() error {
	for _, config := range rm.configList {
		...
		rs, err := newResourceServer(config, filteredDevices, rm.watchMode, rm.socketSuffix)
		if err != nil {
			return err
		}
		rm.resourceServers = append(rm.resourceServers, rs)
	}
	return nil
}
```

newResourceServer() 方法是 resourceServer 结构体的工厂函数，resourceServer 实现了 ``pkg/types/types.go`` 中的 ResourceServer 接口：

```go
// ResourceServer is gRPC server implements K8s device plugin api
type ResourceServer interface {
	pluginapi.DevicePluginServer
	Start() error
	Stop() error
	Restart() error
	Watch()
	UpdateDevices([]PciNetDevice)
}
```

ResourceServer 是一个 gRPC 服务器，实现了 Kubbernetes 的 Device Plugin API，也就是 ``pkg/apis/deviceplugin/v1beta1/api.pb.go`` 定义的内容。
初始化完成之后就是调用 StartAllServers() 方法启动服务器了，调用了 resourceServers 的 Start() 方法：

```go
func (rm *resourceManager) StartAllServers() error {
	for _, rs := range rm.resourceServers {
		if err := rs.Start(); err != nil {
			return err
		}

		// start watcher
		if !rm.watchMode {
			go rs.Watch()
		}
	}
	return nil
}
```

这个 Start() 方法刚好就是 Device Plugin API 提供的 Start() 方法。启动好全部的 gRPC 服务器之后，就是调用 PeriodicUpdate() 方法。这个方法的作用是 “定期更新”，我们来看看定期更新些什么内容：

```go
func (rm *resourceManager) PeriodicUpdate() func() {
	stopChan := make(chan interface{})
	if rm.PeriodicUpdateInterval > 0 {
		ticker := time.NewTicker(rm.PeriodicUpdateInterval)

		// Listen for update or stop update channels
		go func() {
			for {
				select {
				case <-ticker.C:
					if err := rm.DiscoverHostDevices(); err != nil {
						log.Printf("error: failed to discover host devices: %v", err)
						continue
					}

					for index, rs := range rm.resourceServers {
						devices := rm.GetDevices()
						filteredDevices := rm.GetFilteredDevices(devices, &rm.configList[index].Selectors)
						rs.UpdateDevices(filteredDevices)
					}
				case <-stopChan:
					ticker.Stop()
					return
				}
			}
		}()
	}
	// Return stop function
	return func() {
		if rm.PeriodicUpdateInterval > 0 {
			stopChan <- true
			close(stopChan)
		}
	}
}
```

原来是只要定时器不停止，就一直存在一个 Goroutine 不断的调用 ResourceManager 的 DiscoverHostDevices() 和 GetFilteredDevices() 方法，很明显了，是不断的枚举 PCIe 总线上的设备。
枚举完成后进行过滤找出符合要求的 PCIe 设备，调用 UpdateDevices() 方法进行更新：

```go
func (rs *resourceServer) UpdateDevices(devices []types.PciNetDevice) {
	...
	// Create devices list if not exists
	if len(rs.devs) == 0 {
		var devs []*pluginapi.Device
		for n := 0; n < rs.rdmaHcaMax; n++ {
			id := n
			dpDevice := &pluginapi.Device{
				ID:     strconv.Itoa(id),
				Health: pluginapi.Healthy,
			}
			devs = append(devs, dpDevice)
		}
		rs.devs = devs
	}
  ...
}
```

方法的核心在于创建了 pluginapi.Device 的 Slice，这刚好是 ``api.pb.go`` 定义的结构体类型。

这些都准备好以后就会通过 NewSignalNotifier() 方法监听信号：syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT，剩下的就是优雅退出机制了。我们发现 Device Plugin 的 DaemonSet 都是通过 pluginapi 包实现的，
执行 ``grep -Rn "*pluginapi*" pkg/resources/server.go`` 查看符号位置：

```shell
39:     health         chan *pluginapi.Device
44:     devs       []*pluginapi.Device
45:     deviceSpec []*pluginapi.DeviceSpec
78:func (rsc *resourcesServerPort) Register(client pluginapi.RegistrationClient, reqt *pluginapi.RegisterRequest) error {
111:    var devs []*pluginapi.Device
153:            health:         make(chan *pluginapi.Device),
283:func (rs *resourceServer) ListAndWatch(e *pluginapi.Empty, s pluginapi.DevicePlugin_ListAndWatchServer) error {
313:func (rs *resourceServer) sendDevices(resp *pluginapi.ListAndWatchResponse,
329:func (rs *resourceServer) Allocate(ctx context.Context, r *pluginapi.AllocateRequest) (
330:    *pluginapi.AllocateResponse, error) {
335:    ress := make([]*pluginapi.ContainerAllocateResponse, len(r.GetContainerRequests()))
352:func (rs *resourceServer) GetDevicePluginOptions(context.Context, *pluginapi.Empty) (
353:    *pluginapi.DevicePluginOptions, error) {
360:func (rs *resourceServer) PreStartContainer(context.Context, *pluginapi.PreStartContainerRequest) (
361:    *pluginapi.PreStartContainerResponse, error) {
423:            rs.devs = []*pluginapi.Device{}
431:            var devs []*pluginapi.Device
447:func devicesChanged(deviceList, newDeviceList []*pluginapi.DeviceSpec) bool {
467:func getDevicesSpec(devices []types.PciNetDevice) []*pluginapi.DeviceSpec {
468:    devicesSpec := make([]*pluginapi.DeviceSpec, 0)
```

这就眼熟了，resourceServer 把 Plugin Device Protobuf 中定义的函数都实现了一遍。

至此，Kubernetes Device Plugin 和 Deivce Plugin 方案都看了一遍，其实 Device Plugin 最大的缺陷在于只能在 Node 视角去做调度而非集群视角。
笔者在使用 Device Plugin 的时候直接 fork 了 Kubernetes 仓库，对 ManagerImpl 的 Kubelet 源码进行了大量的修改，并且重新开发了 Device Plugin 来支持集群视角的调度。

无论那种调度方案，都避免不了资源碎片，只能看 Pod 中的任务是否可以细分，否则有的 GPU 或者 FPGA 设备确实会在短时间内空闲，其实本质和编程语言的垃圾回收一样的道理。
