#include <jni.h>
#include <memory>
#include "poleline.h"
namespace { std::unique_ptr<poleline::Drawing> drawing=std::make_unique<poleline::Drawing>(); }
extern "C" JNIEXPORT jstring JNICALL Java_app_toyboxes_poleline_NativeCore_catalog(JNIEnv* env,jobject) {return env->NewStringUTF(poleline::catalogJson().c_str());}
extern "C" JNIEXPORT jstring JNICALL Java_app_toyboxes_poleline_NativeCore_select(JNIEnv* env,jobject,jint circuit) {drawing=std::make_unique<poleline::Drawing>(circuit);return env->NewStringUTF(poleline::circuitJson(circuit).c_str());}
extern "C" JNIEXPORT jstring JNICALL Java_app_toyboxes_poleline_NativeCore_touch(JNIEnv* env,jobject,jint action,jdouble x,jdouble y) {return env->NewStringUTF(drawing->touch(action,x,y).c_str());}
extern "C" JNIEXPORT jstring JNICALL Java_app_toyboxes_poleline_NativeCore_race(JNIEnv* env,jobject,jint circuit,jdoubleArray coordinates,jint tyre) {
    jsize n=env->GetArrayLength(coordinates);std::vector<double> xy(n);env->GetDoubleArrayRegion(coordinates,0,n,xy.data());
    return env->NewStringUTF(poleline::raceJson(circuit,xy,tyre).c_str());
}
