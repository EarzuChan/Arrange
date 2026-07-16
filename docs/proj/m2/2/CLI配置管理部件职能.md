之前的过时了，目前正在小范围写。

# 草稿

## SYNC：

分为【CONFIG+SETUP】2 PART，【SCAN+RESOLVE+APPLY】3 阶段（每阶段都进行2 PART的内容，即如：完整版SCAN=CONFIG SCAN+SETUP+SCAN）。
**现在仅实现SYNC的CONFIG PART，SETUP PART还没设计好。**

```
流程【
    LOOP【
        SCAN：进行尽可能全面（但有级联影响，父级有问题则子级扫描不进行，即如：`TextCluster Missing->Skip Regions Scan for that Cluster`）的扫描，**无副作用**
        if scan only: PRINT report & ABORT
        RESOLVE：对SCAN结果中**首个**阻塞项进行交互式操作，操作中修复完（有了副作用）就回到SCAN，放弃修复就ABORT SYNC。当RESOLVE中无遇到任何阻塞，就可以退出循环，继续APPLY
    】
    APPLY：纯确定性的执行，成功执行完：不需要RE-SCAN，算作SYNC完成
】
```