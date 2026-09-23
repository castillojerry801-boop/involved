#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(HealthKitPlugin, "HealthKit",
    CAP_PLUGIN_METHOD(isAvailable, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(requestPermissions, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(queryWorkouts, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(queryBodyMass, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(queryRestingHeartRate, CAPPluginReturnPromise);
)
