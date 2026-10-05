declare module 'mk' {
  import type { Asset, Component, Constructor, Node } from 'cc';

  namespace mk {
    class StaticViewBase extends Component {}

    class ViewBase extends Component {
      initData: unknown;
      init(data?: unknown): void;
      open(): void;
    }

    class EventTarget<T = unknown> {
      on(type: string, callback: (...args: never[]) => void, target?: object): void;
      off(type: string, callback?: (...args: never[]) => void, target?: object): void;
      emit(type: string, ...args: unknown[]): void;
    }

    abstract class MVCModelBase {
      protected _isResetData: boolean;
      static new<T extends new (...args: never[]) => unknown>(
        this: T,
        ...args: ConstructorParameters<T>
      ): Promise<InstanceType<T>>;
      open?(): void;
      close(): void | Promise<void>;
    }

    abstract class MVCViewBase<CT extends MVCModelBase = MVCModelBase> extends ViewBase {
      event: EventTarget;
      protected _model: CT;
      static new?<T extends new (...args: never[]) => unknown>(this: T): Promise<InstanceType<T> | null>;
    }

    abstract class MVCControlBase<
      CT extends MVCModelBase = MVCModelBase,
      CT2 extends MVCViewBase<CT> = MVCViewBase<CT>,
    > {
      constructor();
      get model(): Readonly<Omit<CT, 'open' | 'close'>>;
      protected _model: CT;
      protected _view: CT2;
      close(isExternalCall_?: boolean): void | Promise<void>;
      protected open?(): void | Promise<void>;
    }

    namespace ObjectPool {
      interface SyncConfig<T> {
        createFunc: () => T;
        resetFunc?: (object: T, isCreate: boolean) => T;
        clearFunc?: (objects: T[]) => void;
      }

      class Sync<T> {
        constructor(config: SyncConfig<T>);
        get(): T;
        put(object: T): void;
        clear(): void;
        destroy(): void;
      }
    }

    namespace Audio_ {
      interface Unit {}
    }

    namespace Bundle_ {
      class BundleManageBase {
        nameStr: string;
      }
    }

    const audio: {
      add(path: string, owner: Node, config: { type?: number; loadConfig: { bundleStr: string } }): Promise<Audio_.Unit | null>;
      getGroup(id: number): { volumeNum: number };
      play(unit: Audio_.Unit, config: { volumeNum: number }): Promise<void>;
    };

    const bundle: {
      loadScene(name: string, config: { bundleStr: string }): Promise<boolean>;
    };

    const asset: {
      get<T extends Asset>(path: string, type: Constructor<T>, owner: Node, config?: { bundleStr: string }): Promise<T | null>;
    };

    const uiManage: {
      regis(
        view: abstract new (...args: never[]) => ViewBase,
        prefab: string,
        parent: Node,
        config: Readonly<Record<string, unknown>>,
      ): Promise<void>;
      open(
        view: abstract new (...args: never[]) => ViewBase,
        config: Readonly<Record<string, unknown>>,
      ): Promise<ViewBase | null>;
      close(view: abstract new (...args: never[]) => ViewBase): Promise<void>;
    };
  }

  const mk: typeof mk;
  export default mk;
}
