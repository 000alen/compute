// Override Resource type to allow any property access
declare module "sst" {
  interface Resource {
    [key: string]: any;
  }
}

export {}; 