# 发射工位 07 · 可交互 3D 沙盘

Blender 程序化建模 + three.js 实时渲染的火箭发射场三维装置。支持拖拽旋转、滚轮缩放、昼夜切换、点火发射全流程动画与热点标注。

## 打开方式

需要本地静态服务器（ES Module + GLB 不能用 file:// 直接打开）：

```bash
cd "D:\Downloads\新建文件夹\火箭发射台3D"
python -m http.server 8777 --bind 127.0.0.1
```

浏览器访问 <http://127.0.0.1:8777/>。加 `?debug` 会在左上角显示运行时错误浮层。

## 交互

| 操作 | 效果 |
| --- | --- |
| 拖拽 / 滚轮 | 旋转 / 缩放视角 |
| 点火发射（空格 / L） | 启动 加注 → 倒计时 → 点火 → 起飞 → 上升 全流程 |
| 复位（R） | 中断并复位到待机 |
| 切换视角（C） | 4 组预设机位（全景 / 近景 / 塔架仰视 / 高空）循环 |
| 夜间模式（N） | 昼夜切换，夜间开启探照灯与星空 |
| 标注热点（H） | 显示 / 隐藏结构热点标注 |
| 昼-夜滑块 | 连续过渡昼夜光照 |
| 排气密度滑块 | 20%–180% 调节烟雾与导流槽喷火量 |
| 自动环绕 / 慢动作 | 相机自转；时间缩放 0.35× |

## 目录

```
index.html          HUD 界面、控制面板、importmap
js/main.js          场景装配、GLTF 载入、相机机位、热点、后期
js/env.js           天空 shader、云层、星空、山脊、地面、昼夜插值
js/rocket.js        发射状态机、尾焰三层锥、GPU 粒子烟雾、摆杆回收
blender/build_pad.py 程序化建模脚本（台体/勤务塔/摆杆/火箭/球罐/管线）
assets/launchpad.glb 导出模型（13 节点 / 3394 面 / 0.38 MB）
vendor/three@0.160.0 three.js 本地镜像（离线可用）
preview_day.png / preview_night.png / preview_launch.png  预览图
```

## 重新生成模型

```bash
"D:/Apps/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup \
  --python "D:/Downloads/新建文件夹/火箭发射台3D/blender/build_pad.py"
```

脚本按 three.js 坐标系（X 东 / Y 上 / Z 南）定义构件，导出时自动转 Blender 轴并 `export_yup=True` 转回。

## 结构尺寸

| 构件 | 规格 |
| --- | --- |
| 发射台 | 46 × 46 m，台面高 12 m，13 m 导流槽 + 阶梯导流锥 |
| 勤务塔 | 92 m 高，12 m 见方，19 层，顶部吊车 + 18 m 避雷针 |
| 摆杆 | 3 根，长 4.4 m，可绕 Y 轴回收 |
| 火箭 | 两级半，芯级 Ø5.2 × 46 m，4 台助推，底部 Y=12.6 |
| 推进剂区 | 液氧球罐 Ø22、煤油球罐 Ø26、水塔 Ø18 |
| 附属 | 4 探照灯杆 + 4 避雷塔 + 管线 + 地面标线 |

## 技术要点

- 天空为自定义 shader 球，片元内用 `normalize(vWorldPos - cameraPosition)` 求方向（顶点插值在球内会失真）
- 尾焰三层锥（外橙 / 中亮橙 / 芯白）叠加 AdditiveBlending，配 UnrealBloomPass(0.52, 0.72, 0.70)
- 烟雾为 1500 粒子 GPU Points，单 draw call；密度滑块实时改变发射率
- 昼夜通过 uniform 插值 + 两张 PMREM 环境贴图切换 IBL
