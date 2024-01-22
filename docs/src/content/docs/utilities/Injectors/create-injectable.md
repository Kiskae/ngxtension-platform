---
title: createInjectable
description: A function based approach for creating Injectable services
entryPoint: create-injectable
badge: experimental
contributor: josh-morony
---

`createInjectable` uses `createInjectionToken` behind the scenes as a way to
create injectable services and other types of injectables in Angular without
using classes and decorators.

The general difference is that rather than using a class, we use a `function` to
create the injectable. Whatever the function returns is what will be the
consumable public API of the service, everything else will be private.

To create an injectable that is `providedIn: 'root'` you can omit the `isRoot`
configuration.

## Usage

```ts
// defining a service
export const MyService = createInjectable(
	() => {
		const myState = signal(1);

		return { myState: myState.asReadonly() };
	},
	{ isRoot: false },
);

// using a service
const myService = inject(MyService);
```
