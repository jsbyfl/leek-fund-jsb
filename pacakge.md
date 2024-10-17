# 本地调试打包


## 支持环境

- VSCode 最低版本要求：`v1.40.0+`
- Windows、Mac

### 依赖
```
安装时发现 node 版本要求>= 18.7.0， 目前验证 v20.0.0 通过
```

```
yarn 1.22.19
```

### 命令

- 注意：目前验证发现只能使用yarn

1、安装依赖
```
yarn install --verbose
```

2、编译（必须）
```
yarn compile
```

3、打包
```
yarn package
```