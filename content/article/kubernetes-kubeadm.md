---
title: "学习 kubeadm 源码"
date: 2022-02-15T19:45:08+08:00
draft: false
categories: ["article"]
length: 0
description: "[迁移]通过研究 kubeadm 源代码学习如何构建命令行程序。"
---

# 背景与问题

Kubeadm是芬兰的一个高中生在2015年的夏季所开发的，它本人也是云原生的爱好者，在CNCF社区处于领导职位。在Kubeadm没有发布之前，Kubernetes社区面临的问题是部署困难，且没有统一的、官方的部署方式。

愿意尝试使用Kubernetes的人必须忍受繁琐的步骤并且需要弄清楚整个Kubernetes的架构细节，例如拷贝二进制、分发证书、设置命令行启动参数等。随后Kubernetes社区提供了一个安装脚本，叫做kube-up，但是依旧是用于测试的，很快开源社区便出现了使用Chef、Puppet、Ansible等自动化部署工具构建的部署方式。但是这些部署方式都不是完美的并且也不是官方所推荐的。

社区开始在外界寻找灵感，Docker Swarm的出现刺激了社区的开发人员，Kubeadm就这样诞生了。Kubernetes整个软件的设计是采用模块化的，高内聚低耦合，支持各种灵活的部署方式，确定Kubeadm的设计目标后，由Kubernetes SIG负责设计的Kubeadm开始并入Kubernetes源代码作为官方所推荐的生产环境下的部署工具。

使用Kubeadm并不需要深入了解Kubernetes的各种细节，但是通过本文深入探索Kubeadm的设计与实现，你可以还原整个Kubernetes集群部署所做的细节。

# 搭建源代码分析环境

Kubernetes的源代码由于实现的缘故，目前有些地方仅支持类UNIX系统，我们所需的工具如下：

- Goland：JetBrains出品的Goland是主流的付费Golang IDE，具有强大的静态代码分析与推导能力，开源软件作者和教育工作者可以获得免费的许可。如果你不愿意为此付费，Mircosoft Visual Studio Code也是一个比较不错的编辑器，基于Electron开发，但是编辑器终究还是编辑器。
- Vim：跨平台的文本编辑器，我们需要在Linux服务器上安装，以方便随时查看代码。
- Go 1.17.x：Kubernetes版本与Golang的版本是绑定关系，本文采用Kubernetes 1.22.x版本，因此需要安装Go 1.17.x
- Open SSH Server：我们Mac/Windows上的Kubernetes源代码编辑完成以后需要通过Goland内置的SFTP上传到Linux服务器。
- Git：Kubernetes源代码使用分布式版本控制系统Git来管理。
- Ubuntu 21.04：Linux发行版，你可以选择自己喜欢的Linux发行版。
- GCC、G++环境：Kubernetes源代码中不仅Go代码，还有C/C++代码和汇编ASM代码，因此你需要为Linux服务器部署C/C++环境。如果你想在本地编译Kubernetes源代码，那么你需要安装Vistual Studio或者XCode。

具体的方式如下图所示：

![](/article/kubernetes-kubeadm/640.png)

在Linux发行版上执行如下命令部署基本的开发环境：

```shell
sudo apt install golang make build-ess* -y
```

然后克隆Kubernetes源代码存储库到本地：

```shell
mkdir $GOPATH/src/k8s.io && cd $GOPATH/src/k8s.io
git clone https://github.com/kubernetes/kubernetes.git kubernetes
cd kubernetes
```

完成以后，使用Goland打开即可。Goland会分析代码构建索引，并且安装依赖，如果依赖安装失败，你需要手动安装Kubernetes所需的库：

```shell
go mod download
```

由于某些未知的原因，将Kubernetes存储库克隆到本地后可能会出现文件目录权限丢失问题，通过执行本文提供的脚本（仅类UNIX系统）实现修复：

```shell
chmod +x ./fix-limit.sh  # Git克隆后文件权限发生变化可能会导致编译失败
./fix-limit.sh           # 执行脚本修复权限
```

```shell
#!/usr/bin/env bash
# filename: fix-limit.sh
# description: Fix the existing file permission problem.

echo 'Starting...'
sudo find . -type d -exec chmod 755 {} \;
sudo find . -type d -name '.*' -exec chmod 755 {} \;
sudo find . -type f -exec chmod 644 {} \;
sudo find . -type f -name "*.sh" -exec chmod +x {} \;
sudo find . -type f -name '.*' -exec chmod 644 {} \;
echo 'Done'
```

# Kubeadm 的执行架构与命令架构

Kubeadm和Kubectl一样，都是使用Cobra这个库实现的，Cobra是构建具备现代应用程序风格的命令行工具库。最终的数据结构是cobra.Command，它包装了命令的名称和对应的函数。根据Go Project Layout规范，显然，Kubeadm的二进制命令源码文件位于：``$GOPATH/src/k8s.io/kubernetes/cmd/kubeadm/kubeadm.go``。在分析源代码之前，我们首先看看整个Kubeadm的架构设计。Kubeadm将任务分为多个阶段，叫做Phase，每个Phase本质上是一个执行流程，例如执行主机节点的内存检查。因此Phase是由任意个Check构成的，Check实现了Checker接口。Phase被添加到工作流Workflow中，由Workflow的Runner执行具体的逻辑，然后返回结果。每个Phase中的Check都会返回一个errors类型的错误对象，然后由Phase计算全部的Check有哪些没有通过，然后将错误信息写到标准输出和错误输出。

具体的执行架构如下图所示：

![](/article/kubernetes-kubeadm/641.png)

介绍完Kubeadm的任务执行架构之后，我们再来介绍一下命令与子命令是如何构建的。上面提到过，kubeadm使用cobra构建的，cobra使用cobra.Command包装命令和子命令。通过AddCommand方法将一个cobra.Command结构挂载到另一个结构上。从整体上看，cobra.Command构成了树结构。如下图所示：

![](/article/kubernetes-kubeadm/642.png)

接下来，我们将会深入分析kubeadm init、kubeadm join和kubeadm reset的实现。

# 细说 kubeadm init

打开 ``cmd/kubeadm/kubeadm.go`` 文件，可以看到main函数：

```go
func main() {
  ...
  kubeadmutil.CheckErr(app.Run())
}
```

它调用了app.Run()函数，这个函数返回一个errors类型，然后由kubeadmutil.CheckErr将错误转换为人类友好的字符串打印到标准输出或者错误输出。
在app.Run()函数位于 ``cmd/kubeadm/app/kubeadm.go`` 文件中，主要功能是返回一个cobra.Command结构，如下所示：

```go
func Run() error {
  ...
  return cmd.NewKubeadmCommand(os.Stdin, os.Stdout, os.Stderr).Execute()
}
```

此函数主要功能是构建kubeadm的主命令然后为自己挂载子命令：

```go

func NewKubeadmCommand(in io.Reader, out, err io.Writer) *cobra.Command {
  ...
  cmds := &cobra.Command{}
  ...
  cmds.AddCommand(newCmdCertsUtility(out))
  cmds.AddCommand(newCmdCompletion(out, ""))
  cmds.AddCommand(newCmdConfig(out))
  cmds.AddCommand(newCmdInit(out, nil))
  cmds.AddCommand(newCmdJoin(out, nil))
  cmds.AddCommand(newCmdReset(in, out, nil))
  cmds.AddCommand(newCmdVersion(out))
  cmds.AddCommand(newCmdToken(out, err))
  cmds.AddCommand(upgrade.NewCmdUpgrade(out))
  cmds.AddCommand(alpha.NewCmdAlpha())
  cmds.AddCommand(newCmdKubeConfigUtility(out))
  ...
  return cmds
}
```

接下来我们看看newCmdInit()函数，它位于``cmd/kubeadm/app/cmd/init.go``中:

```go
func newCmdInit(out io.Writer, initOptions *initOptions) *cobra.Command {
  if initOptions == nil { 
    initOptions = newInitOptions()
  }
  ...
  initRunner := workflow.NewRunner() 
  ...
  cmd := &cobra.Command{} 
  ...
  initRunner.AppendPhase(phases.NewPreflightPhase())
  initRunner.AppendPhase(phases.NewCertsPhase())
  initRunner.AppendPhase(phases.NewKubeConfigPhase())
  initRunner.AppendPhase(phases.NewKubeletStartPhase())
  initRunner.AppendPhase(phases.NewControlPlanePhase())
  initRunner.AppendPhase(phases.NewEtcdPhase())
  initRunner.AppendPhase(phases.NewWaitControlPlanePhase())
  initRunner.AppendPhase(phases.NewUploadConfigPhase())
  initRunner.AppendPhase(phases.NewUploadCertsPhase())
  initRunner.AppendPhase(phases.NewMarkControlPlanePhase())
  initRunner.AppendPhase(phases.NewBootstrapTokenPhase())
  initRunner.AppendPhase(phases.NewKubeletFinalizePhase())
  initRunner.AppendPhase(phases.NewAddonPhase())
  ...
  return cmd
}
```

显然，这个函数主要做了四个事情：

- 创建阶段执行所需要的Options
- 创建一个Runner
- 创建kubeadm init子命令所需要的cobra.Command结构体对象
- 为刚才创建的Runner挂载Phase

那么我们以一个Phase为例分析NewPrefightPhase函数的具体实现：

```go
func NewPreflightPhase() workflow.Phase {
  return workflow.Phase {
    Name:    "preflight",
    Run:     runPreflight,
    ...
  }
}
```

通过上述代码可以看到，NewXxxPhase函数主要做的事情是创建workflow.Phase结构体对象。这个Phase最重要的两个属性是Name和Run：

- Name: 用于定义Phase的名称
- Run: 用于挂载Phase的具体逻辑，每个Phase都有一个与之对应的runXxx函数用于执行具体的业务逻辑。

我们可以看到runPrefight的具体实现如下：

```go
func runPreflight(c workflow.RunData) error {
  data, ok := c.(InitData)
  if !ok {
    return errors.New("使用无效数据结构调用预检阶段")
  }

  fmt.Println("[预检] 执行预检")
  // 此处执行主机节点的检查
  if err := preflight.RunInitNodeChecks(utilsexec.New(), data.Cfg(), data.IgnorePreflightErrors(), false, false); err != nil {
    return err
  }

  if !data.DryRun() {
    fmt.Println("[预检] 提取设置Kubernetes集群所需的镜像")
    fmt.Println("[预检] 这可能需要一两分钟，具体取决于您的互联网连接速度")
    fmt.Println("[预检] 您也可以使用 kubeadm config images pull")
    if err := preflight.RunPullImagesCheck(utilsexec.New(), data.Cfg(), data.IgnorePreflightErrors()); err != nil {
      return err
    }
  } else {
    fmt.Println("[预检] 需要提取所需的镜像 (例如 kubeadm config images pull")
  }

  return nil
}
```

这个函数主要的事情是检查传过来的workflow.RunData是否可以断言成InitData类型，然后立刻调用prefight.RunInitNodeChecks()函数执行预检操作。按照之前的执行架构介绍章节，我们可以大胆猜测该函数里边有一堆XxxCheck结构体对象被调用了Check()方法。提前剧透，事实也是如此的。

值得一提，data.DryRun()函数的作用是用于读取用户执行kubeadm init传入的参数，kubeadm init由很多的子阶段构成，用户可以执行指定的阶段。如果只是执行预检操作并不对当前主机执行初始化操作，那么kubeadm将会提示我们可以拉取构建Kubernetes集群所需的容器镜像了。

进入preflight.RunInitNodeChecks函数，位于 ``cmd/kubeadm/app/preflight/checks.go`` 文件中：

```go
func RunInitNodeChecks(execer utilsexec.Interface, cfg *kubeadmapi.InitConfiguration, ignorePreflightErrors sets.String, isSecondaryControlPlane bool, downloadCerts bool) error {
  if !isSecondaryControlPlane {
    // 首先，检查我们是否独立于其他预检检查并快速失败
    if err := RunRootCheckOnly(ignorePreflightErrors); err != nil {
      return err
    }
  }

  // 获取到清单文件的绝对目录
  manifestsDir := filepath.Join(kubeadmconstants.KubernetesDir, kubeadmconstants.ManifestsSubDirName)
  checks := []Checker{
    NumCPUCheck{NumCPU: kubeadmconstants.ControlPlaneNumCPU},
    // 只有Linux
    // TODO: 支持其他操作系统，如果它支持控制平面的话
    // 检查节点的内存大小
    MemCheck{Mem: kubeadmconstants.ControlPlaneMem},
    // 检查Kubernetes版本和kubeadm的版本是否存在冲突
    KubernetesVersionCheck{KubernetesVersion: cfg.KubernetesVersion, KubeadmVersion: kubeadmversion.Get().GitVersion},
    // 检查所需要的端口是否被墙了
    FirewalldCheck{ports: []int{int(cfg.LocalAPIEndpoint.BindPort), kubeadmconstants.KubeletPort}},
    // 检查端口是否打开
    PortOpenCheck{port: int(cfg.LocalAPIEndpoint.BindPort)},
    PortOpenCheck{port: kubeadmconstants.KubeSchedulerPort},
    PortOpenCheck{port: kubeadmconstants.KubeControllerManagerPort},
    // 检查静态Pod的YAML文件是否可用
    FileAvailableCheck{Path: kubeadmconstants.GetStaticPodFilepath(kubeadmconstants.KubeAPIServer, manifestsDir)},
    FileAvailableCheck{Path: kubeadmconstants.GetStaticPodFilepath(kubeadmconstants.KubeControllerManager, manifestsDir)},
    FileAvailableCheck{Path: kubeadmconstants.GetStaticPodFilepath(kubeadmconstants.KubeScheduler, manifestsDir)},
    FileAvailableCheck{Path: kubeadmconstants.GetStaticPodFilepath(kubeadmconstants.Etcd, manifestsDir)},
    // 检查连接到API Server的HTTPS链接是直连还是走代理
    HTTPProxyCheck{Proto: "https", Host: cfg.LocalAPIEndpoint.AdvertiseAddress},
  }

  cidrs := strings.Split(cfg.Networking.ServiceSubnet, ",")
  for _, cidr := range cidrs {
    checks = append(checks, HTTPProxyCIDRCheck{Proto: "https", CIDR: cidr})
  }

  cidrs = strings.Split(cfg.Networking.PodSubnet, ",")
  for _, cidr := range cidrs {
    checks = append(checks, HTTPProxyCIDRCheck{Proto: "https", CIDR: cidr})
  }

  if !isSecondaryControlPlane {
    // 一些其他的杂七杂八的检查
    checks = addCommonChecks(execer, cfg.KubernetesVersion, &cfg.NodeRegistration, checks)

    // 检查是否设置了网桥过滤器和IPv6相关标志
    if ip := net.ParseIP(cfg.LocalAPIEndpoint.AdvertiseAddress); ip != nil {
      // 如果是IPv6地址的话，还得增加其他的检查
      if utilsnet.IsIPv6(ip) {
        checks = append(checks,
          // 检查指定的文件中是否包含指定的内容
          FileContentCheck{Path: bridgenf6, Content: []byte{'1'}},
          FileContentCheck{Path: ipv6DefaultForwarding, Content: []byte{'1'}},
        )
      }
    }

    // 如果使用外部etcd
    if cfg.Etcd.External != nil {
      // 在创建集群之前，请检查外部etcd的版本
      checks = append(checks, ExternalEtcdVersionCheck{Etcd: cfg.Etcd})
    }
  }

  if cfg.Etcd.Local != nil {
    // 仅在需要安装本地etcd时进行etcd相关检查
    checks = append(checks,
      PortOpenCheck{port: kubeadmconstants.EtcdListenClientPort},
      PortOpenCheck{port: kubeadmconstants.EtcdListenPeerPort},
      DirAvailableCheck{Path: cfg.Etcd.Local.DataDir},
    )
  }

  if cfg.Etcd.External != nil && !(isSecondaryControlPlane && downloadCerts) {
    // 仅在使用外部etcd时检查etcd证书，不加入certs的自动下载
    if cfg.Etcd.External.CAFile != "" {
      checks = append(checks, FileExistingCheck{Path: cfg.Etcd.External.CAFile, Label: "ExternalEtcdClientCertificates"})
    }
    if cfg.Etcd.External.CertFile != "" {
      checks = append(checks, FileExistingCheck{Path: cfg.Etcd.External.CertFile, Label: "ExternalEtcdClientCertificates"})
    }
    if cfg.Etcd.External.KeyFile != "" {
      checks = append(checks, FileExistingCheck{Path: cfg.Etcd.External.KeyFile, Label: "ExternalEtcdClientCertificates"})
    }
  }

  return RunChecks(checks, os.Stderr, ignorePreflightErrors)
}
```

显然，此函数构建checks数组，然后调用RunChecks()函数。上边的检查主要包含一下几个部分：

- 处理器检查：检查所需要的对比值在cmd/kubeadm/app/constants/constans.go中进行了预定义。
- 内存检查
- 版本检查：Kubernetes版本和Kubeadm版本需要满足兼容性要求。
- 防火墙检查
- 端口检查
- 静态Pod文件检查：Kubernetes组件被部署为静态Pod
- ETCD检查：主要分为内部ETCD检查和采用独立的外部ETCD检查
- 连通性检查

前文提到过，这些XxxCheck实现的是Checker接口：

```go
// Checker 验证系统状态，以确保kubeadm尽可能地成功。
type Checker interface {
  Check() (warnings, errorList []error)
  Name() string
}
```

Name()函数的实现一般是返回该Check的名称，例如:

```go
func (FirewalldCheck) Name() string {
  return "Firewalld"
}
```

Check()函数则是真正的处理逻辑。RunCheck()函数的内部实现主要是遍历checks数组，调用对应的Check()函数实现检查，然后返回检查错误信息：

```go
// RunChecks 运行每一个检查，显示它的警告/错误，如果任何错误发生并且一旦所有的检查被处理将退出。
func RunChecks(checks []Checker, ww io.Writer, ignorePreflightErrors sets.String) error {
  ...
  for _, c := range checks {
    name := c.Name()
    warnings, errs := c.Check()
    ...
    for _, w := range warnings {
      _, _ = io.WriteString(ww, fmt.Sprintf("\t[警告 %s]: %v\n", name, w))
    }
    for _, i := range errs {
      errsBuffer.WriteString(fmt.Sprintf("\t[错误 %s]: %v\n", name, i.Error()))
    }
  }
  ...
}
```

在NewKubeletStartPhase阶段，尝试在主机上启动kubelet服务，Kubeadm为进程管理实现了通用的结构，位于``cmd/kubeadm/app/phases/kubelet/kubelet.go``中：

```go
initSystem, err := initsystem.GetInitSystem()
```

这行代码调用了initsystem包的GetInitSystem()方法，这个方法返回一个通用的跨平台的操作系统服务管理器，它实现了针对不同的操作系统服务的增删改查：

```go
// WindowsInitSystem 是InitSystem的Windows实现
type WindowsInitSystem struct{}
// OpenRCInitSystem 实现OpenRC的实现
type OpenRCInitSystem struct{}
```

initsystem工具包位于 ``cmd/kubeadm/app/util/initsystem``下。

介绍完NewKubeletStartPhase阶段，再看看NewWaitControlPlane阶段，该阶段用于实现等待API Server成功运行，主要功能是轮询一个HTTP API，然后检查其值是否为ok，超过timeout秒后失败退出，kubeadm会报告初始化Kubernetes集群失败。相同的思路，NewWaitControlPlanePhase()函数会通过Run字段挂载runWaitControlPlanePhase()函数，这个函数会执行具体的业务逻辑，下面是这个函数的具体实现：

```go
func runWaitControlPlanePhase(c workflow.RunData) error {
  ...
  timeout := data.Cfg().ClusterConfiguration.APIServer.TimeoutForControlPlane.Duration
  waiter, err := newControlPlaneWaiter(data.DryRun(), timeout, client, data.OutputWriter())
  if err != nil {
    return errors.Wrap(err, "error creating waiter")
  }

  ...

  if err := waiter.WaitForKubeletAndFunc(waiter.WaitForAPI); err != nil {
    ...
    return errors.New("无法初始化Kubernetes群集")
  }

  return nil
}
```

显然，获取到预定义的timeout后，通过newControlPlaneWaiter函数创建一个Waiter。接下来通过调用waiter的WaitForKubeletAndFunc()方法，然后传入waiter.WaitForAPI函数的指针，进入轮询的具体逻辑。

WaitForKubeletAndFunc()函数创建了两个Goroutinue，一个Goroutinue调用了WaitForHealthyKubelet()函数实现Kubelet进程的监控，另一个Goroutinue就是执行传进来的WaitForAPI()函数了。

```go
// WaitForKubeletAndFunc 主要等待函数f执行，尽管这可能需要一些时间。
// 如果这需要很长时间，并且kubelet /healthz 持续不健康，kubeadm将在一段时间的指数回退后出错
func (w *KubeWaiter) WaitForKubeletAndFunc(f func() error) error {
  errorChan := make(chan error, 1)

  go func(errC chan error, waiter Waiter) {
    if err := waiter.WaitForHealthyKubelet(40*time.Second, fmt.Sprintf("http://localhost:%d/healthz", kubeadmconstants.KubeletHealthzPort)); err != nil {
      errC <- err
    }
  }(errorChan, w)

  go func(errC chan error, waiter Waiter) {
    // 这个主goroutine将f函数返回的任何内容(错误与否)发送到通道
    // 这是为了继续成功(无错误)，或者如果函数返回错误则失败
    errC <- f()
  }(errorChan, w)

  // 此调用被阻止，直到其中一个goroutines发送到errorChan
  return <-errorChan
}
```

WaitForHealthyKubelet()函数与WaitForAPI()函数的实现是完全不一样的，虽然都是轮询。WaitForHealthyKubelet()函数内部使用的是time包的time.Sleep()方法，睡眠一段时间后执行TryRunCommand()函数尝试去运行一个函数，函数内部的实现是通过net/http包创建了HTTP请求。

TryRunCommand()函数实现了轮询的具体逻辑，主要是wait.ExponentialBackoff()函数传入的匿名函数。这个wait.ExponentialBackoff()函数持续检查某一个条件，如果超时或者等待函数返回。
而WaitForAPI()的实现却使用了wait.PollImmediate()方法去一直发送HTTP请求。wait.PollImmediate()方法最终是调用了poll()方法：

```go
func poll(ctx context.Context, immediate bool, wait WaitWithContextFunc, condition ConditionWithContextFunc) error {
  if immediate {
    done, err := runConditionWithCrashProtectionWithContext(ctx, condition)
    if err != nil {
      return err
    }
    if done {
      return nil
    }
  }

  select {
  case <-ctx.Done():
    // 返回ctx.Err()将破坏向后兼容性
    return ErrWaitTimeout
  default:
    return WaitForWithContext(ctx, wait, condition)
  }
}
```

显而易见了，用的是select-case模式实现的。

# 细说 kubeadm join

与kubeadm init类似，在 ``cmd/kubeadm/app/cmd/join.go`` 中也做了同样的事情，不同的是kubeadm join子命令的Phase列表与kubeadm init不同：

```go
func newCmdJoin(out io.Writer, joinOptions *joinOptions) *cobra.Command {
  ...
  joinRunner.AppendPhase(phases.NewPreflightPhase())
  joinRunner.AppendPhase(phases.NewControlPlanePreparePhase())
  joinRunner.AppendPhase(phases.NewCheckEtcdPhase())
  joinRunner.AppendPhase(phases.NewKubeletStartPhase())
  joinRunner.AppendPhase(phases.NewControlPlaneJoinPhase())
  ...
}
```

执行kubeadm join除了要执行与kubeadm init相同的Phase之外，最重要的是NewControlPlanePreparePhase()函数和NewControlPlaneJoinPhase()函数创建的阶段。

NewControlPlanePreparePhase()函数总共分成了四个子阶段：

- newControlPlanePrepareDownloadCertsSubphase(): 下载证书
- newControlPlanePrepareCertsSubphase(): 准备证书
- newControlPlanePrepareKubeconfigSubphase(): 准备kubeconfig文件
- newControlPlanePrepareControlPlaneSubphase(): 创建静态Pod的清单文件

而NewControlPlaneJoinPhase()函数主要做的事情就是更新ETCD、更新状态（ConfigMap的ClusterStatus）和打标记。

- newEtcdLocalSubphase()
- newUpdateStatusSubphase()
- newMarkControlPlaneSubphase()

# 细说 kubeadm reset

显然，根据kubeadm init和kubeadm join得出的结论，kubeadm reset子命令的实现在 ``cmd/kubeadm/app/cmd/reset.go`` 文件中：

```go
func newCmdReset(in io.Reader, out io.Writer, resetOptions *resetOptions) *cobra.Command {
  ...
  resetRunner.AppendPhase(phases.NewPreflightPhase())
  resetRunner.AppendPhase(phases.NewUpdateClusterStatus())
  resetRunner.AppendPhase(phases.NewRemoveETCDMemberPhase())
  resetRunner.AppendPhase(phases.NewCleanupNodePhase())
  ...
}
```

只要我们搞懂了kubeadm init，重置集群的操作就更简单的，无非就是预检完成以后更新集群状态，然后将API Server、ControllerManager等一些静态Pod从etcd中删了（通过etcd的Go客户端执行Delete操作），然后停止进程再删除集群上的文件和目录，还会用到之前介绍的initsystem工具库。
