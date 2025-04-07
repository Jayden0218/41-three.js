import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js";
import * as THREE from "three";
import particlesVertexShader from "./shaders/vertex.glsl";
import particlesFragmentShader from "./shaders/fragment.glsl";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import gpgpuParticlesShader from "./shaders/particles.glsl";
import { Canvas } from "@react-three/fiber";

function GPGPU() {
  const {
    claerColor,

    uFlowFieldInfluence,
    uFlowFieldFrequency,
    uFlowFieldStrength,
  } = useControls({
    claerColor: "#29191f",

    uFlowFieldInfluence: { value: 0.5, min: 0, max: 1, step: 0.01 },
    uFlowFieldStrength: { value: 2, min: 0, max: 10, step: 0.01 },
    uFlowFieldFrequency: { value: 0.5, min: 0, max: 1, step: 0.01 },
  });

  const gltf = useGLTF("/model.glb", { useDraco: true });

  const { size, dpr, gl } = useThree((state) => ({
    size: state.size,
    dpr: state.dpr,
    gl: state.gl,
  }));

  // Base Geometry
  const baseGeometry = useMemo(() => {
    const instance = gltf.scene.children[0].geometry;
    return {
      instance,
      count: instance.attributes.position.count,
    };
  }, [gltf.scene.children]);

  const gpgpu = useMemo(() => {
    const sizeGPGPU = Math.ceil(Math.sqrt(baseGeometry.count));
    const computation = new GPUComputationRenderer(sizeGPGPU, sizeGPGPU, gl);
    const baseParticlesTexture = computation.createTexture();

    for (let i = 0; i < baseGeometry.count; i++) {
      const i4 = i * 4;
      const i3 = i * 3;
      baseParticlesTexture.image.data[i4] =
        baseGeometry.instance.attributes.position.array[i3];
      baseParticlesTexture.image.data[i4 + 1] =
        baseGeometry.instance.attributes.position.array[i3 + 1];
      baseParticlesTexture.image.data[i4 + 2] =
        baseGeometry.instance.attributes.position.array[i3 + 2];
      baseParticlesTexture.image.data[i4 + 3] = Math.random();
    }

    const particlesVariable = computation.addVariable(
      "uParticles",
      gpgpuParticlesShader,
      baseParticlesTexture
    );
    computation.setVariableDependencies(particlesVariable, [particlesVariable]);

    particlesVariable.material.uniforms.uTime = new THREE.Uniform(0);
    particlesVariable.material.uniforms.uDeltaTime = new THREE.Uniform(0);
    particlesVariable.material.uniforms.uBase = new THREE.Uniform(
      baseParticlesTexture
    );
    particlesVariable.material.uniforms.uFlowFieldInfluence = new THREE.Uniform(
      uFlowFieldInfluence
    );
    particlesVariable.material.uniforms.uFlowFieldStrength = new THREE.Uniform(
      uFlowFieldStrength
    );
    particlesVariable.material.uniforms.uFlowFieldFrequency = new THREE.Uniform(
      uFlowFieldFrequency
    );

    computation.init();
    return {
      sizeGPGPU,
      computation,
      baseParticlesTexture,
      particlesVariable,
    };
  }, [
    baseGeometry.count,
    baseGeometry.instance.attributes.position.array,
    gl,
    uFlowFieldFrequency,
    uFlowFieldInfluence,
    uFlowFieldStrength,
  ]);

  useEffect(() => {
    if (gpgpu?.particlesVariable) {
      gpgpu.particlesVariable.material.uniforms.uFlowFieldFrequency.value =
        uFlowFieldFrequency;
      gpgpu.particlesVariable.material.uniforms.uFlowFieldInfluence.value =
        uFlowFieldInfluence;
      gpgpu.particlesVariable.material.uniforms.uFlowFieldStrength.value =
        uFlowFieldStrength;
    }
  }, [
    gpgpu.particlesVariable,
    uFlowFieldFrequency,
    uFlowFieldInfluence,
    uFlowFieldStrength,
  ]);

  const shaderMaterialRef = useRef();

  const uniforms = useMemo(
    () => ({
      uSize: new THREE.Uniform(0.7),
      uResolution: new THREE.Uniform(
        new THREE.Vector2(size.width * dpr, size.height * dpr)
      ),
      uParticlesTexture: new THREE.Uniform(),
    }),

    [dpr, size.height, size.width]
  );

  useEffect(() => {
    shaderMaterialRef.current.uniforms.uResolution.value.set(
      size.width * dpr,
      size.height * dpr
    );
    gl.setClearColor(claerColor);
  }, [size.height, size.width, claerColor, dpr, gl]);

  useFrame((_, delta) => {
    gpgpu.particlesVariable.material.uniforms.uTime.value += delta;
    gpgpu.particlesVariable.material.uniforms.uDeltaTime.value = delta;
    gpgpu.computation.compute();

    // Update the uniform value directly
    shaderMaterialRef.current.uniforms.uParticlesTexture.value =
      gpgpu.computation.getCurrentRenderTarget(gpgpu.particlesVariable).texture;
  });

  useEffect(() => {
    const particlesUvArray = new Float32Array(baseGeometry.count * 2);
    const sizesArray = new Float32Array(baseGeometry.count);

    for (let y = 0; y < gpgpu.sizeGPGPU; y++) {
      for (let x = 0; x < gpgpu.sizeGPGPU; x++) {
        const i = y * gpgpu.sizeGPGPU + x;
        const i2 = i * 2;

        const uvX = (x + 0.5) / gpgpu.sizeGPGPU;
        const uvY = (y + 0.5) / gpgpu.sizeGPGPU;

        particlesUvArray[i2] = uvX;
        particlesUvArray[i2 + 1] = uvY;
        sizesArray[i] = Math.random();
      }
    }

    if (!baseGeometry?.instance?.setAttribute) return;
    baseGeometry.instance.setAttribute(
      "aParticlesUv",
      new THREE.BufferAttribute(particlesUvArray, 2)
    );
    baseGeometry.instance.setAttribute(
      "aColor",
      baseGeometry.instance.attributes.color
    );
    baseGeometry.instance.setAttribute(
      "aSize",
      new THREE.BufferAttribute(sizesArray, 1)
    );
  }, [
    baseGeometry.count,
    baseGeometry.instance,
    gpgpu.gpgpuSize,
    gpgpu.sizeGPGPU,
  ]);

  return (
    <>
      <points>
        <primitive object={baseGeometry.instance} />
        <shaderMaterial
          ref={shaderMaterialRef}
          vertexShader={particlesVertexShader}
          fragmentShader={particlesFragmentShader}
          uniforms={uniforms}
        />
      </points>
      <mesh position-x={3} visible={false}>
        <planeGeometry args={[3, 3]} />
        <meshBasicMaterial
          map={
            gpgpu.computation.getCurrentRenderTarget(gpgpu.particlesVariable)
              .texture
          }
        />
      </mesh>
    </>
  );
}

function App() {
  return (
    <Canvas
      camera={{ fov: 35, position: [4.5, 4, 11] }}
      gl={{ antialias: true }}
    >
      <OrbitControls enableDamping />
      <GPGPU />
    </Canvas>
  );
}

export default App;
