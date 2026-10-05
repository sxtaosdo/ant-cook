declare module 'GlobalConfig' {
  namespace GlobalConfig {
    namespace Audio {
      enum Type {
        Music,
        Effect,
      }
    }
  }
  const GlobalConfig: typeof GlobalConfig;
  export default GlobalConfig;
}
