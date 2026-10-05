import { Asset, Node } from "cc";
import { mkLog } from "../MKLogger";
import MKFollowNodeRelease from "./MKFollowNodeRelease";

/**
 * 对象释放器
 * @remarks
 *
 * - 统一 (Node/Asset) 资源的释放逻辑
 *
 * - 可以通过 function 或继承添加自定义释放逻辑
 */
class MKRelease {
	/** 节点集合 */
	private _nodeList: Node[] = [];
	/** 资源集合 */
	private _assetList: Asset[] = [];
	/** 对象集合 */
	private _objectList: MKRelease_.TypeReleaseObject[] = [];
	/** 回调集合 */
	private _callbackList: MKRelease_.TypeReleaseCallBack[] = [];
	private _releaseAllTask: Promise<void> | null = null;
	/* ------------------------------- 功能 ------------------------------- */
	/**
	 * 释放对象
	 * @param object_ 指定对象
	 */
	static async release(object_?: MKRelease_.TypeReleaseParamType): Promise<void> {
		if (object_ instanceof Node) {
			if (object_.isValid) {
				object_.removeFromParent();
				object_.destroy();
			}
		} else if (object_ instanceof Asset) {
			if (object_.isValid) {
				object_.decRef();
			}
		} else if (typeof object_ === "function") {
			await object_();
		} else if (object_) {
			await object_!.release();
		}
	}

	/**
	 * 跟随释放
	 * @param object_ 跟随释放对象
	 * @param releaseObject_ 释放对象
	 */
	static followRelease(object_: MKRelease_.TypeFollowReleaseSupport, releaseObject_: MKRelease_.TypeReleaseParamType): void {
		if (!object_ || !releaseObject_) {
			return;
		}

		if (object_ instanceof Node) {
			if (!object_.isValid) {
				this.release(releaseObject_);
			} else {
				(object_.getComponent(MKFollowNodeRelease) || object_.addComponent(MKFollowNodeRelease)).followRelease(releaseObject_);
			}
		} else {
			object_.followRelease(releaseObject_);
		}
	}

	/**
	 * 取消跟随释放
	 * @param object_ 跟随释放对象
	 * @param releaseObject_ 释放对象
	 */
	static cancelRelease(object_: MKRelease_.TypeFollowReleaseSupport, releaseObject_: MKRelease_.TypeReleaseParamType): void {
		if (!object_ || !releaseObject_) {
			return;
		}

		if (object_ instanceof Node) {
			if (object_.isValid) {
				(object_.getComponent(MKFollowNodeRelease) || object_.addComponent(MKFollowNodeRelease)).cancelRelease(releaseObject_);
			}
		} else {
			object_.cancelRelease(releaseObject_);
		}
	}

	/**
	 * 添加释放对象
	 * @param object_ 要跟随模块释放的对象或列表
	 */
	add<T extends MKRelease_.TypeReleaseParamType>(object_: T): T {
		if (!object_) {
			mkLog.error("添加释放对象错误", object_);

			return object_;
		}

		// 添加引用数据
		if (object_ instanceof Node) {
			if (object_.isValid) {
				this._nodeList.push(object_);
			}
		} else if (object_ instanceof Asset) {
			if (object_.isValid) {
				this._assetList.push(object_);
			}
		} else if (typeof object_ === "function") {
			this._callbackList.push(object_);
		} else {
			this._objectList.push(object_);
		}

		return object_;
	}

	/**
	 * 删除释放对象
	 * @param object_ 删除跟随模块释放的对象或列表
	 */
	delete<T extends MKRelease_.TypeReleaseParamType>(object_: T): boolean {
		if (!object_) {
			mkLog.error("删除释放对象错误", object_);

			return false;
		}

		let valueList: Array<any> = null!;

		// 添加引用数据
		if (object_ instanceof Node) {
			valueList = this._nodeList;
		} else if (object_ instanceof Asset) {
			valueList = this._assetList;
		} else if (typeof object_ === "function") {
			valueList = this._callbackList;
		} else {
			valueList = this._objectList;
		}

		const indexNum = valueList.indexOf(object_);

		if (indexNum !== -1) {
			valueList.splice(indexNum, 1);
		}

		return indexNum !== -1;
	}

	/**
	 * 释放对象
	 * @param object_ 指定对象
	 */
	async release(object_?: MKRelease_.TypeReleaseParamType): Promise<void> {
		if (object_ instanceof Node) {
			if (this.delete(object_) && object_.isValid) {
				object_.removeFromParent();
				object_.destroy();
			}
		} else if (object_ instanceof Asset) {
			if (this.delete(object_) && object_.isValid) {
				object_.decRef();
			}
		} else if (typeof object_ === "function") {
			if (this.delete(object_)) {
				await object_();
			}
		} else if (this.delete(object_ as any)) {
			await object_!.release();
		}
	}

	/** 释放所有对象 */
	releaseAll(): Promise<void> {
		if (this._releaseAllTask) return this._releaseAllTask;
		const task = this._releaseLedger().finally(() => { if (this._releaseAllTask === task) this._releaseAllTask = null; });
		this._releaseAllTask = task;
		return task;
	}

	private async _releaseLedger(): Promise<void> {
		const errors: unknown[] = [];
		// Remove each successful lease immediately. A failed callback cannot replay a
		// previously released asset on retry, and newly added leases are never erased.
		for (const list of [this._assetList, this._nodeList, this._objectList, this._callbackList]) {
			for (const value of [...list]) {
				try {
					await MKRelease.release(value);
					const index = (list as any[]).indexOf(value);
					if (index !== -1) list.splice(index, 1);
				} catch (cause) { errors.push(cause); }
			}
		}
		if (errors.length) throw new AggregateError(errors, "Resource lease cleanup failed");
	}
}

export namespace MKRelease_ {
	/** 释放对象类型 */
	export type TypeReleaseObject = { release(): any | Promise<any> };
	/** 释放回调类型 */
	export type TypeReleaseCallBack = () => any | Promise<any>;
	/** 释放参数类型 */
	export type TypeReleaseParamType = Node | Asset | TypeReleaseObject | TypeReleaseCallBack;

	/** 跟随释放对象类型 */
	export type TypeFollowReleaseObject<CT = TypeReleaseParamType> = {
		/**
		 * 跟随释放
		 * @param object_ 释放对象/释放对象数组
		 */
		followRelease<T extends CT>(object_: T): void;

		/**
		 * 取消释放
		 * @param object_ 取消释放对象/取消释放对象数组
		 */
		cancelRelease<T extends CT>(object_: T): void;
	};
	/** 跟随释放支持类型 */
	export type TypeFollowReleaseSupport = Node | TypeFollowReleaseObject | null;
}

export default MKRelease;
