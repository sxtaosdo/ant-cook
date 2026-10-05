declare module 'mk' {
  namespace mk {
    const bundle: {
      loadScene(name: string, config: { bundleStr: string }): Promise<boolean>;
    };
  }

  const mk: {
    bundle: {
      loadScene(name: string, config: { bundleStr: string }): Promise<boolean>;
    };
  };

  export default mk;
}
