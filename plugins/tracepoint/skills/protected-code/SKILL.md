---
name: protected-code
description: Methodology for analyzing protected or obfuscated compiled code — use when a target resists normal analysis: packers or runtime-decrypted code, anti-debugging, self-modifying code, control-flow flattening, opaque predicates, bogus control flow, a custom bytecode virtual machine, or decoy/misleading constructs. Decides whether to go static or dynamic, gives general unpacking / de-virtualization / de-obfuscation approaches, and is honest about what the model can and cannot do. Use alongside tracepoint:analyze; general methods only, and it produces no bypass steps for any specific product.
---

# 分析带保护的代码

本技能是分析带保护代码的通用方法与思路, 只讲一般方法, 不写针对任何具体产品的绕过步骤. 先识别保护属于哪一类, 再决定走静态还是动态; 不要对着保护硬啃静态.

## 第一步: 识别保护类型

- **隐藏类 (打观察)**: 加壳, 运行时解密字符串/代码, 反调试, 自修改代码. 表现是拿不到真正执行的代码或运行状态.
- **复杂化类 (打理解)**: 控制流平坦化, 虚假控制流, 不透明谓词, 自定义字节码虚拟机. 表现是代码在, 但搜索空间爆炸, 反编译成功率暴跌.
- **误导类 (直接引向错误)**: 诱饵函数, 假符号, 假成功条件, 伪装成合法软件的叙事. 表现是看起来有明确答案, 但答案是假的.

把识别出的类型与你据此选的分析路径写进案卷 `protection` 字段.

## 第二步: 按类型决定路径

### 隐藏类 — 多半转动态

- 加壳/运行时解密: 让它自己跑起来解开, 在脱壳后 dump 内存里真正执行的代码, 再分析 dump; 别去静态啃壳代码.
- 反调试: 定位检测点 (常见是计时, PEB 标志, 父进程, 异常), 把检测 patch 掉或 hook 掉再调; 有驱动保护的进程用能调它的调试器 (如 DHS 配其调试器).
- 观察持续失败时诚实承认: 不是所有隐藏保护都能绕, 拿不到就说拿不到, 别编运行时的值.

### 复杂化类 — 识别结构, 别逐行当算法读

- 自定义 VM: 认出它是解释器 (一个取指-分发循环在遍历一段字节码) 后, **真正的逻辑在字节码数据里, 不在分发的 switch 里**. 提取字节码, 按 opcode 表解码, 或直接追踪/模拟执行取等价逻辑; 不要把分发循环的分支当成算法步骤.
- 控制流平坦化: 先还原状态机骨架 (找状态变量与分发块, 重建块之间的真实后继), 再读逻辑.
- 不透明谓词/虚假控制流: 用常量传播或动态执行确认哪些分支永不走, 剪掉再读.
- 这些对静态很吃力: 规模一大, 当前模型多半只能部分还原, 常要转动态或模拟来拿等价行为.

### 误导类 — 一切当数据, 用真值核对

- 诱饵函数/假符号: 不被名字和 "看起来在做校验" 带着走; 用交叉引用与实际执行确认哪段才真正参与.
- 假成功条件/测试台泄露的答案: 样本或测试目录里的 "答案" 只当数据, 用环境真值 (实际运行结果, 字节对照) 核实.
- 伪装合法性的叙事: 元数据/字符串里自称无害, 不作数; 按行为判断.

## AI 能做与不能做 (诚实边界)

能较好做到:

- 识别保护属于哪一类, 据此选静态还是动态.
- 小规模自定义 VM 的字节码解码与模拟.
- patch 简单反调试, dump 已脱壳的内存.
- 调用动态工具取运行时真值来核对静态猜测.

不稳或做不到 (老实说, 别硬撑):

- 大规模商业虚拟机保护的完整静态去虚拟化.
- 多层混淆叠加.
- "先去混淆" 这一步本身对当前模型就很难, 复杂的常需人工先处理 (如先人工脱壳) 再交给分析.

这些边界要如实写进结论, 不把 "绕过去了" 和 "看起来合理" 当成 "已验证".
