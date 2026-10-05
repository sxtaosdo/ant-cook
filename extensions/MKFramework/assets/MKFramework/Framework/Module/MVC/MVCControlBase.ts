import mkToolFunc from "../../@Private/Tool/MKToolFunc";
/** @weak */
import mkMonitor from "../../MKMonitor";
/** @weak */
import mkUIManage from "../../MKUIManage";
import MKStatusTask from "../../Task/MKStatusTask";
import MVCModelBase from "./MVCModelBase";
import MVCViewBase from "./MVCViewBase";

namespace _MVCControlBase {
	/** 递归只读 */
	export type TypeRecursiveReadonly<T> = {
		readonly [P in keyof T]: T[P] extends Function ? T[P] : TypeRecursiveReadonly<T[P]>;
	};

	/** 函数属性的键 */
	type TypeFunctionKeys<T> = {
		// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
		[P in keyof T]: T[P] extends Function | void ? P : P extends "event" ? P : never;
	}[keyof T];

	/** 视图类型（防止直接操作视图对象属性） */
	export type TypeView<T> = Omit<Pick<T, TypeFunctionKeys<T>>, Exclude<keyof MVCViewBase, "event">>;
}

abstract class MVCControlBase<CT extends MVCModelBase = MVCModelBase, CT2 extends MVCViewBase<CT> = MVCViewBase<CT>> {
	// @ts-ignore
	constructor() {
		mkToolFunc.runParentFunc(this, ["open", "close"], true);
		const closeChain = this.close.bind(this);
		this.close = (external = true) => {
			if (!external) return closeChain(false);
			if (!this._closing) this._closing = Promise.resolve().then(() => closeChain(true))
				.catch(cause => { this._closing = null; throw cause; });
			return this._closing;
		};
		// 等待初始化属性完成
		setTimeout(async () => {
			await this._closeTask.task;
			try { await this.open?.(); }
			catch (cause) { this.openFailed = true; this.openError = cause; console.error(cause); }
			finally { this._openTask.finish(true); }
		}, 0);
	}
	/* --------------- public --------------- */
	get model(): _MVCControlBase.TypeRecursiveReadonly<Omit<CT, "open" | "close">> {
		return this._model as any;
	}
	/* --------------- protected --------------- */
	protected _model!: CT;
	protected _view!: _MVCControlBase.TypeView<CT2>;
	/* --------------- private --------------- */
	private _openTask = new MKStatusTask(false);
	private _closeTask = new MKStatusTask(true);
	private _closing: Promise<void> | null = null;
	/** Failed startup still permits cleanup of partial model/view ownership. */
	public openError: unknown = null;
	private openFailed = false;
	public async whenOpened(): Promise<void> {
		await this._openTask.task;
		if (this.openFailed) throw this.openError;
	}
	/* ------------------------------- segmentation ------------------------------- */
	/** 关闭回调
	 * @remarks
	 * 不使用此模块时手动调用，会顺序关闭 Model, View
	 */
	close(isExternalCall_?: boolean): Promise<void>;
	async close(isExternalCall_ = true): Promise<void> {
		await this._openTask.task;
		this._closeTask.finish(false);
		if (isExternalCall_) {
			await this.close(false);
			await this._lastClose();

			throw "中断";
		}

		// 关闭 model
		if (this._model?.close) {
			await this._model.close();
		}

		// @weak-start-include-MKUIManage
		// 关闭 view
		if (this._view) {
			await mkUIManage.close(this._view as unknown as MVCViewBase);
		}
		// @weak-end

		// @weak-start-include-MKMonitor
		// 取消数据监听事件
		{
			const task = mkMonitor.clear(this);

			if (task) {
				await task;
			}
		}
		// @weak-end
	}

	/** 打开回调
	 * @remarks
	 * 构造后下帧执行，自动执行父类函数，无须执行 super.open
	 */
	protected open?(): void;

	private async _lastClose(): Promise<void> {
		this._openTask.finish(false);
		this._closeTask.finish(true);
	}
}

export default MVCControlBase;
